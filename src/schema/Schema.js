const Util = require('@coderich/util');
const { Kind, parse, visit } = require('graphql');
const { mergeTypeDefs, mergeFields } = require('@graphql-tools/merge');
const { isLeafValue, isPlainObject, isBasicObject, mergeDeep } = require('../service/AppService');
const Pipeline = require('../data/Pipeline');
const Emitter = require('../data/Emitter');

const operations = ['Query', 'Mutation', 'Subscription'];
const modelKinds = [Kind.OBJECT_TYPE_DEFINITION, Kind.OBJECT_TYPE_EXTENSION, Kind.INTERFACE_TYPE_DEFINITION, Kind.INTERFACE_TYPE_EXTENSION];
const allowedKinds = modelKinds.concat(Kind.DOCUMENT, Kind.FIELD_DEFINITION, Kind.NON_NULL_TYPE, Kind.NAMED_TYPE, Kind.LIST_TYPE, Kind.DIRECTIVE);
const pipelines = ['finalize', 'construct', 'restruct', 'instruct', 'normalize', 'serialize'];
const inputPipelines = ['finalize', 'construct', 'instruct', 'normalize', 'serialize'];

module.exports = class Schema {
  #config;
  #typeDefs;
  #resolvers = {};

  constructor(config) {
    this.#config = config;
    this.#typeDefs = Schema.#gqlFramework();
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
  merge(schema) {
    if (typeof schema === 'string') schema = { typeDefs: schema };
    const { typeDefs, resolvers = {} } = schema;
    this.#typeDefs = mergeTypeDefs([parse(typeDefs), this.#typeDefs], { noLocation: true, reverseDirectives: true, onFieldTypeConflict: a => a });
    this.#resolvers = mergeDeep(this.#resolvers, resolvers);
    return this;
  }

  /**
   * Parse typeDefs; returning a schema POJO
   */
  toObject() {
    let model, field, isField, isList;
    const thunks = [];
    const schema = { models: {}, indexes: [] };

    // Parse AST
    visit(this.#typeDefs, {
      enter: (node) => {
        const name = node.name?.value;
        if (!allowedKinds.includes(node.kind)) return false;

        if (modelKinds.includes(node.kind) && !operations.includes(name)) {
          model = schema.models[name] = {
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
          else if (name === 'index') schema.indexes.push({ model });

          node.arguments.forEach((arg) => {
            const key = arg.name.value;
            const { value: val, values } = arg.value;
            const value = values ? values.map(n => n.value) : val;
            target.directives[name][key] = value;

            if (name === 'index') schema.indexes[schema.indexes.length - 1][key] = value;

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
            $model.crud = $model.isMarkedModel ? $model.crud : '';
            $model.isEntity = Boolean($model.isMarkedModel && !$model.isEmbedded);

            // Utility functions
            $model.resolvePath = (path, prop = 'name') => schema.resolvePath(`${$model[prop]}.${path}`, prop);

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
            $field.linkFrom = $field.isVirtual ? $model.fields[$model.idField].key : $field.key;
            $field.isFKReference = !$field.isPrimaryKey && $field.model?.isMarkedModel && !$field.model?.isEmbedded;
            $field.isEmbedded = Boolean($field.model && !$field.isFKReference && !$field.isPrimaryKey);

            if ($field.isArray) $field.pipelines.normalize.unshift('toArray');
            if ($field.isPrimaryKey) $field.pipelines.serialize.unshift('$pk'); // Will create/convert to FK type always
            if ($field.isFKReference) $field.pipelines.serialize.unshift('$fk'); // Will convert to FK type IFF defined in payload

            if ($field.isRequired && $field.isPersistable && !$field.isVirtual) $field.pipelines.finalize.push('required');
            if ($field.isFKReference) {
              const to = $field.model.key;
              const on = $field.model.fields[$field.linkBy].key;
              const from = $field.linkFrom;
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
    thunks.forEach(thunk => thunk(schema));

    // Resolve indexes
    schema.indexes = schema.indexes.map((index) => {
      const { key } = index.model;
      const { name, type } = index;
      const on = index.on.map(f => index.model.fields[f].key);
      return { key, name, type, on };
    });

    // Resolve referential integrity
    Object.values(schema.models).forEach(($model) => {
      $model.referentialIntegrity = Schema.#identifyOnDeletes(Object.values(schema.models), $model.name);
    });

    // Helper methods
    schema.resolvePath = (path, prop = 'key') => {
      const [modelKey, ...fieldKeys] = path.split('.');
      const $model = Object.values(schema.models).find(el => el[prop] === modelKey);
      if (!$model || !fieldKeys.length) return $model;
      return fieldKeys.reduce((parent, key) => Object.values(parent.fields || parent.model.fields).find(el => el[prop] === key) || parent, $model);
    };

    // Emit event now that we're set up
    Emitter.emit('setup', { schema });

    // Return schema
    return schema;
  }

  toExecutableSchema() {
    return {
      typeDefs: this.#config.typeDefs,
      resolvers: this.#config.resolvers,
    };
  }

  makeExecutableSchema() {
    return this.#config.makeExecutableSchema(this.toObject());
  }

  static #gqlFramework() {
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

  static #gqlAPI(schema) {
    return {
      typeDefs: `
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

        type Query {
          node(id: ID!): Node
          entityModels.map(model => makeReadAPI(model.getName(), model))}
        }

        type Mutation {
          entityModels.map(model => makeCreateAPI(model.getName(), model))}
          entityModels.map(model => makeUpdateAPI(model.getName(), model))}
          entityModels.map(model => makeDeleteAPI(model.getName(), model))}
        }

        type Subscription {
          entityModels.map(model => makeSubscriptionAPI(model.getName(), model))}
        }
      `,
      resolvers: {

      },
    };
  }

  static #identifyOnDeletes(models, parentName) {
    return models.reduce((prev, model) => {
      Object.values(model.fields).filter(f => f.onDelete).forEach((field) => {
        if (`${field.model.name}` === `${parentName}`) {
          if (model.isEntity) {
            prev.push({ model, field, isArray: field.isArray, op: field.onDelete });
          } else {
            prev.push(...Schema.#identifyOnDeletes(models, model.name).map(od => Object.assign(od, { fieldRef: field.name, isArray: field.isArray, op: field.onDelete })));
          }
        }
      });

      // Assign model referential integrity
      return Util.filterBy(prev, (a, b) => `${a.model.name}:${a.field.name}:${a.fieldRef}:${a.op}` === `${b.model.name}:${b.field.name}:${b.fieldRef}:${b.op}`);
    }, []);
  }
};
