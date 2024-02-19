/* eslint-disable indent */

const Util = require('@coderich/util');
const { Kind, parse, visit } = require('graphql');
const { mergeTypeDefs, mergeFields } = require('@graphql-tools/merge');
const { isLeafValue, mergeDeep, fromGUID } = require('../service/AppService');
const Pipeline = require('../data/Pipeline');
const Emitter = require('../data/Emitter');

const operations = ['Query', 'Mutation', 'Subscription'];
const interfaceKinds = [Kind.INTERFACE_TYPE_DEFINITION, Kind.INTERFACE_TYPE_EXTENSION];
// const unionKinds = [Kind.UNION_TYPE_DEFINITION, Kind.UNION_TYPE_EXTENSION];
const enumKinds = [Kind.ENUM_TYPE_DEFINITION, Kind.ENUM_TYPE_EXTENSION];
const scalarKinds = [Kind.SCALAR_TYPE_DEFINITION, Kind.SCALAR_TYPE_EXTENSION];
const fieldKinds = [Kind.FIELD_DEFINITION];
const modelKinds = [Kind.OBJECT_TYPE_DEFINITION, Kind.OBJECT_TYPE_EXTENSION].concat(interfaceKinds);
const allowedKinds = modelKinds.concat(fieldKinds).concat(Kind.DOCUMENT, Kind.NON_NULL_TYPE, Kind.NAMED_TYPE, Kind.LIST_TYPE, Kind.DIRECTIVE).concat(scalarKinds).concat(enumKinds);
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
    this.#config.namespace ??= 'autograph';
    this.#config.directives ??= {};
    this.#config.directives.model ??= 'model';
    this.#config.directives.field ??= 'field';
    this.#config.directives.link ??= 'link';
    this.#config.directives.index ??= 'index';
    this.#typeDefs = Schema.#framework(this.#config.directives);
  }

  /* ****** DEPRECATE! ****** */
  getModels() {
    return this.#schema.models;
  }

  getModel(name) {
    return this.#schema.models[`${name}`];
  }
  /* ***************** */

  /**
   * Decorate each marked @model with config-driven field decorators
   */
  decorate() {
    const { directives } = this.#config;

    this.#typeDefs = visit(this.#typeDefs, {
      enter: (node) => {
        if (modelKinds.includes(node.kind) && !operations.includes(node.name.value)) {
          const directive = node.directives.find(({ name }) => name.value === directives.model);

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
    // Normalize schema input
    if (typeof schema === 'string') schema = { typeDefs: schema };
    else if (schema instanceof Schema) schema = schema.toObject();

    if (schema.typeDefs) {
      const typeDefs = Util.ensureArray(schema.typeDefs).map((td) => {
        try {
          const $td = typeof td === 'string' ? parse(td) : td;
          return $td;
        } catch (e) {
          console.log(`Unable to parse typeDef (being ignored):\n${td}`); // eslint-disable-line
          return null;
        }
      }).filter(Boolean);

      this.#typeDefs = mergeTypeDefs([typeDefs, this.#typeDefs], { noLocation: true, reverseDirectives: true, onFieldTypeConflict: a => a });
    }

    if (schema.resolvers) {
      this.#resolvers = mergeDeep(this.#resolvers, schema.resolvers);
    }

    return this;
  }

  /**
   * Parse typeDefs; returning a schema POJO
   */
  parse() {
    if (this.#schema) return this.#schema;

    const { directives, namespace } = this.#config;
    this.#schema = { models: {}, enums: {}, scalars: {}, indexes: [], namespace };
    let target, model, field, isList;
    const thunks = [];

    // Deprecate
    this.#schema.getModel = name => this.#schema.models[`${name}`];

    // Parse AST (build/defined this.#schema)
    visit(this.#typeDefs, {
      enter: (node) => {
        const name = node.name?.value;
        if (!allowedKinds.includes(node.kind) || operations.includes(name)) return false;

        if (modelKinds.includes(node.kind)) {
          target = model = this.#schema.models[name] = {
            name,
            key: name,
            fields: {},
            crud: 'crud', // For use when creating API Queries and Mutations
            scope: 'crud', // For use when defining types (how it's field.model reference can be used)
            idField: 'id',
            isPersistable: true,
            source: this.#config.dataSources?.default,
            loader: this.#config.dataLoaders?.default,
            pipelines: pipelines.reduce((prev, key) => Object.assign(prev, { [key]: [] }), {}),
            directives: {},
            toString: () => name,
          };
        }

        if (fieldKinds.includes(node.kind)) {
          target = field = model.fields[name] = {
            name,
            key: name,
            pipelines: pipelines.reduce((prev, key) => Object.assign(prev, { [key]: [] }), {}),
            directives: {},
            toString: () => name,
          };
        }

        if (scalarKinds.includes(node.kind)) {
          scalars.push(name);
          target = this.#schema.scalars[name] = {
            directives: {},
            pipelines: pipelines.reduce((prev, key) => Object.assign(prev, { [key]: [] }), {}),
          };
        }

        if (enumKinds.includes(node.kind)) {
          target = this.#schema.enums[name] = {
            directives: {},
            pipelines: pipelines.reduce((prev, key) => Object.assign(prev, { [key]: [] }), {}),
          };

          // Define (and assign) an Allow pipeline for the enumeration
          const values = Schema.#resolveNodeValue(node);
          Pipeline.define(name, Pipeline.Allow(...values), { configurable: true });
          target.pipelines.finalize.push(name);
        }

        if (node.kind === Kind.NON_NULL_TYPE) {
          target[isList ? 'isArrayRequired' : 'isRequired'] = true;
        } else if (node.kind === Kind.NAMED_TYPE) {
          target.type = node.name.value;
        } else if (node.kind === Kind.LIST_TYPE) {
          target.isArray = true;
          isList = true;
        } else if (node.kind === Kind.DIRECTIVE) {
          target.directives[name] = target.directives[name] || {};

          if (name === directives.model) model.isMarkedModel = true;
          else if (name === directives.index) this.#schema.indexes.push({ model });

          node.arguments.forEach((arg) => {
            const key = arg.name.value;
            const value = Schema.#resolveNodeValue(arg.value);
            target.directives[name][key] = value;

            if (name === directives.index) this.#schema.indexes[this.#schema.indexes.length - 1][key] = value;

            switch (`${name}-${key}`) {
              // Model specific directives
              case `${directives.model}-id`: {
                model.idField = value;
                break;
              }
              case `${directives.model}-source`: {
                model.source = this.#config.dataSources?.[value];
                break;
              }
              case `${directives.model}-loader`: {
                model.loader = this.#config.dataLoaders?.[value];
                break;
              }
              case `${directives.model}-embed`: {
                model.isEmbedded = value;
                break;
              }
              // Field specific directives
              case `${directives.field}-default`: {
                target.defaultValue = value;
                break;
              }
              case `${directives.field}-connection`: {
                target.isConnection = value;
                break;
              }
              case `${directives.field}-validate`: { // Alias for finalize
                target.pipelines.finalize = target.pipelines.finalize.concat(value).filter(Boolean);
                break;
              }
              case `${directives.link}-by`: {
                target.linkBy = value;
                target.isVirtual = true;
                break;
              }
              // Generic by target directives
              case `${directives.model}-persist`: case `${directives.field}-persist`: {
                target.isPersistable = value;
                break;
              }
              case `${directives.model}-crud`: case `${directives.model}-scope`: case `${directives.field}-crud`: {
                target[key] = Util.nvl(value, '');
                break;
              }
              case `${directives.model}-key`: case `${directives.model}-meta`: case `${directives.field}-key`: case `${directives.field}-onDelete`: {
                target[key] = value;
                break;
              }

              // Backwards compat (deprecated)
              case 'model-gqlScope': { model.crud = value; break; }
              case 'model-fieldScope': { model.scope = value; break; }
              case 'field-gqlScope': { target.crud = value; break; }

              // Pipelines
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
        if (modelKinds.includes(node.kind)) {
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
              if (data == null || !Util.isPlainObject(data)) return data;

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
                const $value = opts.itemize && $field.model && Util.isPlainObjectOrArray($node.value) ? Util.map($node.value, el => $field.model.walk(el, fn, { ...opts, path, run })) : $node.value;
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
            $field.crud = Util.uvl($field.crud, $field.model?.scope, 'crud');
            $field.linkBy ??= $field.model?.idField;
            $field.linkField = $field.isVirtual ? $model.fields[$model.idField] : $field;
            $field.isFKReference = !$field.isPrimaryKey && $field.model?.isMarkedModel && !$field.model?.isEmbedded;
            $field.isEmbedded = Boolean($field.model && !$field.isFKReference && !$field.isPrimaryKey);
            $field.isScalar = scalars.includes($field.type);

            // Merge Enums and Scalar type definitions
            const enumer = this.#schema.enums[$field.type];
            const scalar = this.#schema.scalars[$field.type];
            if (enumer) Object.entries(enumer.pipelines).forEach(([key, values]) => $field.pipelines[key].push(...values));
            if (scalar) Object.entries(scalar.pipelines).forEach(([key, values]) => $field.pipelines[key].push(...values));

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

          target = model;
        } else if (node.kind === Kind.LIST_TYPE) {
          isList = false;
        } else if (scalarKinds.concat(enumKinds).includes(node.kind)) {
          target = model;
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

    // Mutate typeDefs
    let $model;
    this.#typeDefs = visit(this.#typeDefs, {
      enter: (node) => {
        const name = node.name?.value;
        if (!allowedKinds.includes(node.kind) || operations.includes(name)) return false;

        if (modelKinds.includes(node.kind)) {
          $model = this.#schema.models[name];
        } else if (fieldKinds.includes(node.kind)) {
          if (!Util.uvl($model?.fields[name]?.crud, 'crud')?.includes('r')) return null;
        }

        return undefined;
      },
    });

    // Return schema
    return this.#schema;
  }

  api() {
    return this.merge(Schema.#api(this.parse()));
  }

  framework() {
    this.#typeDefs = Schema.#framework(this.#config.directives);
    return this;
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

  static #resolveNodeValue(node) {
    switch (node.kind) {
      case 'NullValue': return null;
      case 'ListValue': return node.values.map(Schema.#resolveNodeValue);
      case 'EnumValueDefinition': return node.name.value;
      case 'EnumTypeDefinition': return node.values.map(Schema.#resolveNodeValue);
      case 'ObjectValue': return node.fields.reduce((prev, field) => Object.assign(prev, { [field.name.value]: Schema.#resolveNodeValue(field.value) }), {});
      default: return node.value ?? node;
    }
  }

  static #framework(directives) {
    const { model, field, link, index } = directives;

    return parse(`
      scalar AutoGraphMixed
      scalar AutoGraphDriver # DELETE WHEN MIGRATED

      enum AutoGraphIndexEnum { unique }
      enum AutoGraphAuthzEnum { private protected public } # DELETE WHEN MIGRATED
      enum AutoGraphOnDeleteEnum { cascade nullify restrict defer }
      enum AutoGraphPipelineEnum { ${Object.keys(Pipeline).filter(k => !k.startsWith('$')).join(' ')} }

      directive @${model}(
        id: String # Specify the ID/PK field (default "id")
        key: String # Specify db table/collection name
        crud: AutoGraphMixed # CRUD API
        scope: AutoGraphMixed #
        meta: AutoGraphMixed # Custom input "meta" field for mutations
        source: AutoGraphMixed # Data source (default: "default")
        decorate: AutoGraphMixed # Decorator (default: "default")
        embed: Boolean # Mark this an embedded model (default false)
        persist: Boolean # Persist this model (default true)

        # TEMP TO APPEASE TRANSITION
        driver: AutoGraphDriver # External data driver
        createdAt: String # Specify db key (default "createdAt")
        updatedAt: String # Specify db key (default "updatedAt")
        gqlScope: AutoGraphMixed # Dictate how GraphQL API behaves
        dalScope: AutoGraphMixed # Dictate how the DAL behaves
        fieldScope: AutoGraphMixed # Dictate how a FIELD may use me
        authz: AutoGraphAuthzEnum # Access level used for authorization (default: private)
        namespace: String # Logical grouping of models that can be globbed (useful for authz)
      ) on OBJECT | INTERFACE

      directive @${field}(
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
        validate: [AutoGraphPipelineEnum!] # Alias for finalize

        # TEMP TO APPEASE TRANSITION
        id: String # Specify the ModelRef this field FK References
        ref: AutoGraphMixed # Specify the modelRef field's name (overrides isEmbedded)
        gqlScope: AutoGraphMixed # Dictate how GraphQL API behaves
        dalScope: AutoGraphMixed # Dictate how the DAL behaves
        destruct: [AutoGraphPipelineEnum!]
        transform: [AutoGraphPipelineEnum!]
        deserialize: [AutoGraphPipelineEnum!]
      ) on FIELD_DEFINITION | INPUT_FIELD_DEFINITION | SCALAR

      directive @${link}(
        to: AutoGraphMixed  # The MODEL to link to (default's to modelRef)
        by: AutoGraphMixed! # The FIELD to match yourself by
        use: AutoGraphMixed # The VALUE to use (default's to @link'd value); useful for many-to-many relationships
      ) on FIELD_DEFINITION

      directive @${index}(
        name: String
        on: [AutoGraphMixed!]!
        type: AutoGraphIndexEnum!
      ) repeatable on OBJECT
    `);
  }

  static #api(schema) {
    // These models are for creating types
    const readModels = Object.values(schema.models).filter(model => [model.crud, model.scope].join()?.includes('r'));
    const createModels = Object.values(schema.models).filter(model => [model.crud, model.scope].join()?.includes('c'));
    const updateModels = Object.values(schema.models).filter(model => [model.crud, model.scope].join()?.includes('u'));

    // These are for defining schema queries/mutations
    const entityModels = Object.values(schema.models).filter(model => model.isEntity);
    const queryModels = entityModels.filter(model => model.crud?.includes('r'));
    const mutationModels = entityModels.filter(model => ['c', 'u', 'd'].some(el => model.crud?.includes(el)));
    const subscriptionModels = entityModels.filter(model => model.crud?.includes('s'));

    return {
      typeDefs: `
        scalar AutoGraphMixed
        scalar AutoGraphDateTime

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
          const fields = Object.values(model.fields).filter(field => field.crud?.includes('r'));
          const connectionFields = fields.filter(field => field.isConnection);

          return `
            input ${model}InputWhere {
              ${fields.map(field => `${field}: ${field.model ? `${field.model}InputWhere` : 'AutoGraphMixed'}`)}
            }
            input ${model}InputSort {
              ${fields.map(field => `${field}: ${field.model ? `${field.model}InputSort` : 'SortOrderEnum'}`)}
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
          const fields = Object.values(model.fields).filter(field => field.crud?.includes('c') && !field.isVirtual);

          return `
            input ${model}InputCreate {
              ${fields.map(field => `${field}: ${Schema.#getGQLType(field, 'InputCreate')}`)}
            }
          `;
        })}

        ${updateModels.map((model) => {
          const fields = Object.values(model.fields).filter(field => field.crud?.includes('u') && !field.isVirtual);

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
              if (model.crud?.includes('c')) api.push(`create${model}(input: ${model}InputCreate! ${meta}): ${model}!`);
              if (model.crud?.includes('u')) api.push(`update${model}(id: ID! input: ${model}InputUpdate ${meta}): ${model}!`);
              if (model.crud?.includes('d')) api.push(`delete${model}(id: ID! ${meta}): ${model}!`);
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

          ${subscriptionModels.map((model) => {
            const fields = Object.values(model.fields).filter(field => field.crud?.includes('r'));

            return `
              input ${model}SubscriptionInputFilter {
                when: [SubscriptionWhenEnum!]! = [preEvent, postEvent]
                where: ${model}SubscriptionInputWhere! = {}
              }

              input ${model}SubscriptionInputWhere {
                ${fields.map(field => `${field}: ${field.model ? `${field.model}InputWhere` : 'AutoGraphMixed'}`)}
              }

              type ${model}SubscriptionPayload {
                event: ${model}SubscriptionPayloadEvent
                query: ${model}SubscriptionQuery
              }

              type ${model}SubscriptionPayloadEvent {
                crud: SubscriptionCrudEnum!
                data: ${model}SubscriptionPayloadEventData!
              }

              type ${model}SubscriptionPayloadEventData {
                ${fields.map(field => `${field}: ${Schema.#getGQLType(field)}`)}
              }

              interface ${model}SubscriptionQuery {
                ${fields.map(field => `${field}: ${Schema.#getGQLType(field)}`)}
              }

              type ${model}Create implements ${model}SubscriptionQuery {
                ${fields.map(field => `${field}: ${Schema.#getGQLType(field)}`)}
              }

              type ${model}Update implements ${model}SubscriptionQuery {
                ${fields.map(field => `${field}: ${Schema.#getGQLType(field)}`)}
              }
            `;
          })}
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
            [`get${model}`]: (doc, args, context, info) => context[schema.namespace].resolver.match(model).args(args).info(info).one({ required: true }),
            [`find${model}`]: (doc, args, context, info) => {
              return {
                edges: () => context[schema.namespace].resolver.match(model).args(args).info(info).many(),
                count: () => context[schema.namespace].resolver.match(model).args(args).info(info).count(),
                pageInfo: () => context[schema.namespace].resolver.match(model).args(args).info(info).many(),
              };
            },
          });
        }, {
          node: (doc, args, context, info) => {
            const { id } = args;
            const [modelName] = fromGUID(id);
            const model = schema.models[modelName];
            return context[schema.namespace].resolver.match(model).id(id).info(info).one().then((result) => {
              if (result == null) return result;
              result.__typename = modelName; // eslint-disable-line no-underscore-dangle
              return result;
            });
          },
        }),
        ...(mutationModels.length ? {
          Mutation: mutationModels.reduce((prev, model) => {
            if (model.crud?.includes('c')) prev[`create${model}`] = (doc, args, context, info) => context[schema.namespace].resolver.match(model).args(args).info(info).save(args.input);
            if (model.crud?.includes('u')) prev[`update${model}`] = (doc, args, context, info) => context[schema.namespace].resolver.match(model).args(args).info(info).save(args.input);
            if (model.crud?.includes('d')) prev[`delete${model}`] = (doc, args, context, info) => context[schema.namespace].resolver.match(model).args(args).info(info).delete();
            return prev;
          }, {}),
        } : {}),
        ...readModels.reduce((prev, model) => {
          return Object.assign(prev, {
            [model]: Object.values(model.fields).filter(field => field.model?.isEntity).reduce((prev2, field) => {
              return Object.assign(prev2, {
                [field]: (doc, args, context, info) => {
                  return context[schema.namespace].resolver.match(field.model).where({ [field.linkBy]: doc[field.linkField.name] }).args(args).info(info).resolve(info);
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
    const { isEmbedded, isRequired, isScalar, isArray, isArrayRequired, isPrimaryKey, defaultValue } = field;
    const modelType = `${type}${suffix}`;
    if (suffix && !isScalar) type = isEmbedded ? modelType : 'ID';
    type = isArray ? `[${type}${isArrayRequired ? '!' : ''}]` : type;
    if (!suffix && isRequired) type += '!';
    if (suffix === 'InputCreate' && !isPrimaryKey && isRequired && defaultValue == null) type += '!';
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
