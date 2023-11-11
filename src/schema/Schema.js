/* eslint-disable indent */

const Util = require('@coderich/util');
const { Kind, parse, visit } = require('graphql');
const { mergeTypeDefs, mergeFields } = require('@graphql-tools/merge');
const { isLeafValue, isPlainObject, isBasicObject, mergeDeep, fromGUID } = require('../service/AppService');
const Pipeline = require('../data/Pipeline');
const Emitter = require('../data/Emitter');

const operations = ['Query', 'Mutation', 'Subscription'];
// const interfaceKinds = [Kind.INTERFACE_TYPE_DEFINITION, Kind.INTERFACE_TYPE_EXTENSION];
const modelKinds = [Kind.OBJECT_TYPE_DEFINITION, Kind.OBJECT_TYPE_EXTENSION, Kind.INTERFACE_TYPE_DEFINITION, Kind.INTERFACE_TYPE_EXTENSION];
const allowedKinds = modelKinds.concat(Kind.DOCUMENT, Kind.FIELD_DEFINITION, Kind.NON_NULL_TYPE, Kind.NAMED_TYPE, Kind.LIST_TYPE, Kind.DIRECTIVE);
const pipelines = ['finalize', 'construct', 'restruct', 'instruct', 'normalize', 'serialize'];
const inputPipelines = ['finalize', 'construct', 'instruct', 'normalize', 'serialize'];
const scalars = ['ID', 'String', 'Float', 'Int', 'Boolean'];

module.exports = class Schema {
  #config;
  #schema;
  #typeDefs;
  #resolvers = {};

  constructor(config) {
    this.#config = config;
    this.#typeDefs = Schema.#framework();
  }

  /**
   * Decorate each marked @model with config-driven field decorators
   */
  decorate() {
    this.#typeDefs = visit(this.#typeDefs, {
      enter: (node) => {
        if (modelKinds.includes(node.kind) && !operations.includes(node.name.value)) {
          const directive = node.directives.find(({ name }) => name.value === 'model');

          if (directive) {
            const arg = directive.arguments.find(({ name }) => name.value === 'decorate');
            const value = arg?.value.value || 'default';
            const decorator = this.#config.decorators?.[value];

            if (decorator) {
              const { fields } = parse(`type decorator { ${decorator} }`).definitions[0];
              node.fields = mergeFields(node, node.fields, fields, { noLocation: true, onFieldTypeConflict: a => a });
              return node;
            }
          }

          return false;
        }

        return undefined;
      },
    });

    return this;
  }

  /**
   * Merge typeDefs and resolvers
   */
  merge(schema = {}) {
    if (typeof schema === 'string') schema = { typeDefs: schema };
    else if (schema instanceof Schema) schema = schema.toObject();
    const { typeDefs, resolvers } = schema;
    if (typeDefs) this.#typeDefs = mergeTypeDefs([parse(typeDefs), this.#typeDefs], { noLocation: true, reverseDirectives: true, onFieldTypeConflict: a => a });
    if (resolvers) this.#resolvers = mergeDeep(this.#resolvers, resolvers);
    return this;
  }

  /**
   * Parse typeDefs; returning a schema POJO
   */
  parse() {
    if (this.#schema) return this.#schema;

    this.#schema = { models: {}, indexes: [] };
    let model, field, isField, isList;
    const thunks = [];

    // Parse AST
    visit(this.#typeDefs, {
      enter: (node) => {
        const name = node.name?.value;
        if (!allowedKinds.includes(node.kind)) return false;

        if (modelKinds.includes(node.kind) && !operations.includes(name)) {
          model = this.#schema.models[name] = {
            name,
            key: name,
            fields: {},
            idField: 'id',
            crud: 'crud',
            scope: 'crud',
            isPersistable: true,
            source: this.#config.dataSources?.default,
            loader: this.#config.dataLoaders?.default,
            directives: {},
            toString: () => name,
          };
        } else if (node.kind === Kind.FIELD_DEFINITION) {
          isField = true;
          field = model.fields[name] = {
            name,
            key: name,
            crud: 'crud',
            pipelines: pipelines.reduce((prev, key) => Object.assign(prev, { [key]: [] }), {}),
            directives: {},
            toString: () => name,
          };
        } else if (node.kind === Kind.NON_NULL_TYPE) {
          field[isList ? 'isArrayRequired' : 'isRequired'] = true;
        } else if (node.kind === Kind.NAMED_TYPE) {
          field.type = node.name.value;
        } else if (node.kind === Kind.LIST_TYPE) {
          field.isArray = true;
          isList = true;
        } else if (node.kind === Kind.DIRECTIVE) {
          const target = isField ? field : model;
          target.directives[name] = target.directives[name] || {};

          if (name === 'model') model.isMarkedModel = true;
          else if (name === 'index') this.#schema.indexes.push({ model });

          node.arguments.forEach((arg) => {
            const key = arg.name.value;
            const { value: val, values } = arg.value;
            const value = values ? values.map(n => n.value) : val;
            target.directives[name][key] = value;

            if (name === 'index') this.#schema.indexes[this.#schema.indexes.length - 1][key] = value;

            switch (`${name}-${key}`) {
              // Model specific directives
              case 'model-id': {
                model.idField = value;
                break;
              }
              case 'model-source': {
                model.source = this.#config.dataSources?.[value];
                break;
              }
              case 'model-loader': {
                model.loader = this.#config.dataLoaders?.[value];
                break;
              }
              case 'model-embed': {
                model.isEmbedded = value;
                break;
              }
              // Field specific directives
              case 'field-default': {
                field.defaultValue = value;
                break;
              }
              case 'field-connection': {
                field.isConnection = value;
                break;
              }
              case 'link-by': {
                field.linkBy = value;
                field.isVirtual = true;
                break;
              }
              // Generic by target directives
              case 'model-persist': case 'field-persist': {
                target.isPersistable = value;
                break;
              }
              case 'model-crud': case 'model-scope': case 'field-crud': {
                target[key] = Util.nvl(value, '');
                break;
              }
              case 'model-key': case 'model-meta': case 'field-key': case 'field-onDelete': {
                target[key] = value;
                break;
              }
              default: {
                if (pipelines.includes(key)) {
                  target.pipelines[key] = target.pipelines[key].concat(value).filter(Boolean);
                }
                break;
              }
            }
          });
        }

        return undefined; // Continue
      },
      leave: (node) => {
        if (modelKinds.includes(node.kind) && !operations.includes(node.name.value)) {
          const $model = model;
          // const idField = $model.fields[$model.idField];
          // $model.primaryKey = Util.nvl(idField?.key, idField?.name, 'id');

          // Model resolution after field resolution (push)
          thunks.push(($schema) => {
            $model.isEntity = Boolean($model.isMarkedModel && !$model.isEmbedded);

            $model.resolvePath = (path, prop = 'name') => this.#schema.resolvePath(`${$model[prop]}.${path}`, prop);

            $model.isJoinPath = (path, prop = 'name') => {
              let foundJoin = false;
              return !path.split('.').every((el, i, arr) => {
                if (foundJoin) return false;
                const $field = $model.resolvePath(arr.slice(0, i + 1).join('.'), prop);
                foundJoin = $field.isVirtual || $field.isFKReference;
                return !$field.isVirtual;
              });
            };

            $model.walk = (data, fn, opts = {}) => {
              if (data == null || !isPlainObject(data)) return data;

              // Options
              opts.key = opts.key ?? 'name';
              opts.run = opts.run ?? [];
              opts.path = opts.path ?? [];
              opts.itemize = opts.itemize ?? true;

              return Object.entries(data).reduce((prev, [key, value]) => {
                // Find the field; remove it if not found
                const $field = Object.values($model.fields).find(el => el[opts.key] === key);
                if (!$field) return prev;

                // Invoke callback function; allowing result to be modified in order to change key/value
                let run = opts.run.concat($field[opts.key]);
                const path = opts.path.concat($field[opts.key]);
                const isLeaf = isLeafValue(value);
                const $node = fn({ model: $model, field: $field, key, value, path, run, isLeaf });
                if (!$node) return prev;

                // Recursive walk
                if (!$field.model?.isEmbedded) run = [];
                const $value = opts.itemize && $field.model && isBasicObject($node.value) ? Util.map($node.value, el => $field.model.walk(el, fn, { ...opts, path, run })) : $node.value;
                return Object.assign(prev, { [$node.key]: $value });
              }, {});
            };

            // Pre-processing
            $model.pipelineFields = {
              input: Object.values($model.fields).filter(f => f.defaultValue !== undefined || inputPipelines.some(k => f.pipelines[k].length)).reduce((prev, f) => Object.assign(prev, { [f.name]: undefined }), {}),
              where: Object.values($model.fields).filter(f => f.pipelines.instruct.length).reduce((prev, f) => Object.assign(prev, { [f.name]: undefined }), {}),
            };
          });
        } else if (node.kind === Kind.FIELD_DEFINITION) {
          const $field = field;
          const $model = model;

          $field.isPrimaryKey = Boolean($field.name === model.idField);
          $field.isPersistable = Util.uvl($field.isPersistable, model.isPersistable, true);

          // Field resolution comes first (unshift)
          thunks.unshift(($schema) => {
            $field.model = $schema.models[$field.type];
            $field.linkBy = $field.linkBy || $field.model?.idField;
            $field.linkField = $field.isVirtual ? $model.fields[$model.idField] : $field;
            $field.isFKReference = !$field.isPrimaryKey && $field.model?.isMarkedModel && !$field.model?.isEmbedded;
            $field.isEmbedded = Boolean($field.model && !$field.isFKReference && !$field.isPrimaryKey);
            $field.isScalar = Boolean(!$field.model || scalars.includes($field.type));

            if ($field.isArray) $field.pipelines.normalize.unshift('toArray');
            if ($field.isPrimaryKey) $field.pipelines.serialize.unshift('$pk'); // Will create/convert to FK type always
            if ($field.isFKReference) $field.pipelines.serialize.unshift('$fk'); // Will convert to FK type IFF defined in payload

            if ($field.isRequired && $field.isPersistable && !$field.isVirtual) $field.pipelines.finalize.push('required');
            if ($field.isFKReference) {
              const to = $field.model.key;
              const on = $field.model.fields[$field.linkBy].key;
              const from = $field.linkField.key;
              const as = `join_${to}`;
              $field.join = { to, on, from, as };
              $field.pipelines.finalize.push('ensureId'); // Absolute Last
            }
          });

          isField = false;
        } else if (node.kind === Kind.LIST_TYPE) {
          isList = false;
        }
      },
    });

    // Resolve data thunks
    thunks.forEach(thunk => thunk(this.#schema));

    // Resolve indexes
    this.#schema.indexes = this.#schema.indexes.map((index) => {
      const { key } = index.model;
      const { name, type } = index;
      const on = index.on.map(f => index.model.fields[f].key);
      return { key, name, type, on };
    });

    // Resolve referential integrity
    Object.values(this.#schema.models).forEach(($model) => {
      $model.referentialIntegrity = Schema.#identifyOnDeletes(Object.values(this.#schema.models), $model.name);
    });

    // Helper methods
    this.#schema.resolvePath = (path, prop = 'key') => {
      const [modelKey, ...fieldKeys] = path.split('.');
      const $model = Object.values(this.#schema.models).find(el => el[prop] === modelKey);
      if (!$model || !fieldKeys.length) return $model;
      return fieldKeys.reduce((parent, key) => Object.values(parent.fields || parent.model.fields).find(el => el[prop] === key) || parent, $model);
    };

    // Return schema
    return this.#schema;
  }

  api() {
    return this.merge(Schema.#api(this.parse()));
  }

  setup() {
    return Emitter.emit('setup', this.#schema);
  }

  toObject() {
    return {
      typeDefs: this.#typeDefs,
      resolvers: this.#resolvers,
    };
  }

  makeExecutableSchema() {
    return this.#config.makeExecutableSchema(this.toObject());
  }

  static #framework() {
    return parse(`
      scalar AutoGraphMixed

      enum AutoGraphIndexEnum { unique }
      enum AutoGraphOnDeleteEnum { cascade nullify restrict defer }
      enum AutoGraphPipelineEnum { ${Object.keys(Pipeline).filter(k => !k.startsWith('$')).join(' ')} }

      directive @model(
        id: String # Specify the ID/PK field (default "id")
        key: String # Specify db table/collection name
        crud: AutoGraphMixed # CRUD API
        scope: AutoGraphMixed #
        meta: AutoGraphMixed # Custom input "meta" field for mutations
        source: AutoGraphMixed # Data source (default: "default")
        embed: Boolean # Mark this an embedded model (default false)
        persist: Boolean # Persist this model (default true)
      ) on OBJECT | INTERFACE

      directive @field(
        key: String # Specify db key
        persist: Boolean # Persist this field (default true)
        connection: Boolean # Treat this field as a connection type (default false - rolling this out slowly)
        default: AutoGraphMixed # Define a default value
        crud: AutoGraphMixed # CRUD API
        onDelete: AutoGraphOnDeleteEnum # onDelete behavior

        # Pipeline Structure
        normalize: [AutoGraphPipelineEnum!]
        instruct: [AutoGraphPipelineEnum!]
        construct: [AutoGraphPipelineEnum!]
        restruct: [AutoGraphPipelineEnum!]
        serialize: [AutoGraphPipelineEnum!]
        finalize: [AutoGraphPipelineEnum!]
      ) on FIELD_DEFINITION | INPUT_FIELD_DEFINITION | SCALAR

      directive @link(
        to: AutoGraphMixed  # The MODEL to link to (default's to modelRef)
        by: AutoGraphMixed! # The FIELD to match yourself by
        use: AutoGraphMixed # The VALUE to use (default's to @link'd value); useful for many-to-many relationships
      ) on FIELD_DEFINITION

      directive @index(
        name: String
        on: [AutoGraphMixed!]!
        type: AutoGraphIndexEnum!
      ) repeatable on OBJECT
    `);
  }

  static #api(schema) {
    // These models are for creating types
    const readModels = Object.values(schema.models).filter(model => model.crud.includes('r'));
    const createModels = Object.values(schema.models).filter(model => model.crud.includes('c'));
    const updateModels = Object.values(schema.models).filter(model => model.crud.includes('u'));

    // These are for defining schema queries/mutations
    const entityModels = Object.values(schema.models).filter(model => model.isEntity);
    const queryModels = entityModels.filter(model => model.crud.includes('r'));
    const mutationModels = entityModels.filter(model => ['c', 'u', 'd'].some(el => model.crud.includes(el)));
    const subscriptionModels = entityModels.filter(model => model.crud.includes('s'));

    return {
      typeDefs: `
        scalar AutoGraphMixed

        interface Node { id: ID! }

        enum SortOrderEnum { asc desc }
        enum SubscriptionCrudEnum { create update delete }
        enum SubscriptionWhenEnum { preEvent postEvent }

        type PageInfo {
          startCursor: String!
          endCursor: String!
          hasPreviousPage: Boolean!
          hasNextPage: Boolean!
        }

        ${entityModels.map(model => `
          extend type ${model} implements Node {
            id: ID!
          }
        `)}

        ${readModels.map((model) => {
          const fields = Object.values(model.fields).filter(field => field.crud.includes('r'));
          const connectionFields = fields.filter(field => field.isConnection);

          return `
            input ${model}InputWhere {
              ${fields.map(field => `${field}: ${field.model?.isEntity ? `${field.model}InputWhere` : 'AutoGraphMixed'}`)}
            }
            input ${model}InputSort {
              ${fields.map(field => `${field}: ${field.model?.isEntity ? `${field.model}InputSort` : 'SortOrderEnum'}`)}
            }
            type ${model}Connection {
              count: Int!
              pageInfo: PageInfo
              edges: [${model}Edge]
            }
            type ${model}Edge {
              node: ${model}
              cursor: String
            }
            ${connectionFields.length ? `
              extend type ${model} {
                ${connectionFields.map(field => `${field}: ${field.model}Connection`)}
              }
            ` : ''}
          `;
        })}

        ${createModels.map((model) => {
          const fields = Object.values(model.fields).filter(field => field.crud.includes('c') && !field.isVirtual);

          return `
            input ${model}InputCreate {
              ${fields.map(field => `${field}: ${Schema.#getGQLType(field, 'InputCreate')}`)}
            }
          `;
        })}

        ${updateModels.map((model) => {
          const fields = Object.values(model.fields).filter(field => field.crud.includes('u') && !field.isVirtual);

          return `
            input ${model}InputUpdate {
              ${fields.map(field => `${field}: ${Schema.#getGQLType(field, 'InputUpdate')}`)}
            }
          `;
        })}

        type Query {
          node(id: ID!): Node
          ${queryModels.map(model => `
            get${model}(id: ID!): ${model}
            find${model}(
              where: ${model}InputWhere
              sortBy: ${model}InputSort
              limit: Int
              skip: Int
              first: Int
              after: String
              last: Int
              before: String
            ): ${model}Connection!
          `)}
        }

        ${mutationModels.length ? `
          type Mutation {
            ${mutationModels.map((model) => {
              const api = [];
              const meta = model.meta ? `meta: ${model.meta}` : '';
              if (model.crud.includes('c')) api.push(`create${model}(input: ${model}InputCreate! ${meta}): ${model}!`);
              if (model.crud.includes('u')) api.push(`update${model}(id: ID! input: ${model}InputUpdate ${meta}): ${model}!`);
              if (model.crud.includes('d')) api.push(`delete${model}(id: ID! ${meta}): ${model}!`);
              return api.join('\n');
            })}
          }
        ` : ''}

        ${subscriptionModels.length ? `
          type Subscription {
            ${subscriptionModels.map(model => `
              ${model}(
                on: [SubscriptionCrudEnum!]! = [create, update, delete]
                filter: ${model}SubscriptionInputFilter
              ): ${model}SubscriptionPayload!
            `)}
          }
        ` : ''}
      `,
      resolvers: {
        Node: {
          __resolveType: (doc, args, context, info) => doc.__typename, // eslint-disable-line no-underscore-dangle
        },
        ...queryModels.reduce((prev, model) => {
          return Object.assign(prev, {
            [`${model}Connection`]: {
              count: ({ count }) => count(),
              edges: ({ edges }) => edges().then(rs => rs.map(node => ({ cursor: node.$cursor, node }))),
              pageInfo: ({ pageInfo }) => pageInfo().then(rs => rs?.$pageInfo),
            },
          });
        }, {}),
        Query: queryModels.reduce((prev, model) => {
          return Object.assign(prev, {
            [`get${model}`]: (doc, args, context, info) => context.autograph.resolver.match(model).args(args).one({ required: true }),
            [`find${model}`]: (doc, args, context, info) => {
              return {
                edges: () => context.autograph.resolver.match(model).args(args).many(),
                count: () => context.autograph.resolver.match(model).args(args).count(),
                pageInfo: () => context.autograph.resolver.match(model).args(args).many(),
              };
            },
          });
        }, {
          node: (doc, args, context, info) => {
            const { id } = args;
            const [modelName] = fromGUID(id);
            const model = schema.models[modelName];
            return context.autograph.resolver.match(model).id(id).one().then((result) => {
              if (result == null) return result;
              result.__typename = modelName; // eslint-disable-line no-underscore-dangle
              return result;
            });
          },
        }),
        ...(mutationModels.length ? {
          Mutation: mutationModels.reduce((prev, model) => {
            if (model.crud.includes('c')) prev[`create${model}`] = (doc, args, context, info) => context.autograph.resolver.match(model).args(args).save(args.input);
            if (model.crud.includes('u')) prev[`update${model}`] = (doc, args, context, info) => context.autograph.resolver.match(model).args(args).save(args.input);
            if (model.crud.includes('d')) prev[`delete${model}`] = (doc, args, context, info) => context.autograph.resolver.match(model).args(args).delete();
            return prev;
          }, {}),
        } : {}),
        ...readModels.reduce((prev, model) => {
          return Object.assign(prev, {
            [model]: Object.values(model.fields).filter(field => field.model?.isEntity).reduce((prev2, field) => {
              return Object.assign(prev2, {
                [field]: (doc, args, context, info) => {
                  return context.autograph.resolver.match(field.model).where({ [field.linkBy]: doc[field.linkField.name] }).args(args).resolve(info);
                },
              });
            }, {}),
          });
        }, {}),
      },
    };
  }

  static #getGQLType(field, suffix) {
    let { type } = field;
    const { isEmbedded, isRequired, isScalar, isArray, isArrayRequired, defaultValue } = field;
    const modelType = `${type}${suffix}`;
    if (suffix && !isScalar) type = isEmbedded ? modelType : 'ID';
    type = isArray ? `[${type}${isArrayRequired ? '!' : ''}]` : type;
    if (!suffix && isRequired) type += '!';
    if (suffix === 'InputCreate' && isRequired && defaultValue != null) type += '!';
    return type;
  }

  static #identifyOnDeletes(models, parentName) {
    return models.reduce((prev, model) => {
      Object.values(model.fields).filter(f => f.onDelete).forEach((field) => {
        if (`${field.model.name}` === `${parentName}`) {
          if (model.isEntity) {
            prev.push({ model, field, isArray: field.isArray, op: field.onDelete });
          }
          // else {
          //   prev.push(...Schema.#identifyOnDeletes(models, model.name).map(od => Object.assign(od, { fieldRef: field.name, isArray: field.isArray, op: field.onDelete })));
          // }
        }
      });

      // Assign model referential integrity
      return Util.filterBy(prev, (a, b) => `${a.model.name}:${a.field.name}:${a.fieldRef}:${a.op}` === `${b.model.name}:${b.field.name}:${b.fieldRef}:${b.op}`);
    }, []);
  }
};
