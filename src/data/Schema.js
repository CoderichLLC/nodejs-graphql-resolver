const FS = require('fs');
const Util = require('@coderich/util');
const { Kind, print, parse, visit, isSchema } = require('graphql');

module.exports = class Schema {
  #gql;

  constructor(mixed) {
    try {
      if (isSchema(mixed)) this.#gql = print(mixed);
      else if (FS.statSync(mixed)) this.#gql = FS.readFileSync(mixed, 'utf8');
      else this.#gql = mixed;
    } catch (e) {
      this.#gql = mixed;
    }
  }

  parse() {
    let model, field, isField, isList;
    const thunks = [];
    const schema = { models: {}, indexes: [] };
    const operations = ['Query', 'Mutation', 'Subscription'];
    const modelKinds = [Kind.OBJECT_TYPE_DEFINITION, Kind.OBJECT_TYPE_EXTENSION, Kind.INTERFACE_TYPE_DEFINITION, Kind.INTERFACE_TYPE_EXTENSION];
    const allowedKinds = modelKinds.concat(Kind.DOCUMENT, Kind.FIELD_DEFINITION, Kind.NON_NULL_TYPE, Kind.NAMED_TYPE, Kind.LIST_TYPE, Kind.DIRECTIVE);

    // Parse AST
    visit(parse(this.#gql), {
      enter: (node) => {
        if (!allowedKinds.includes(node.kind)) return false;

        if (modelKinds.includes(node.kind) && !operations.includes(node.name.value)) {
          const name = node.name.value;
          model = schema.models[name] = { key: name, name, idField: 'id', fields: {} };
        } else if (node.kind === Kind.FIELD_DEFINITION) {
          const name = node.name.value;
          field = model.fields[name] = { key: name, name, pipelines: { validate: [], serialize: [] } };
          isField = true;
        } else if (node.kind === Kind.NON_NULL_TYPE) {
          field[isList ? 'isArrayRequired' : 'isRequired'] = true;
        } else if (node.kind === Kind.NAMED_TYPE) {
          field.type = node.name.value;
        } else if (node.kind === Kind.LIST_TYPE) {
          field.isArray = true;
          isList = true;
        } else if (node.kind === Kind.DIRECTIVE) {
          const name = node.name.value;
          const target = isField ? field : model;

          if (name === 'model') model.isMarkedModel = true;
          else if (name === 'index') schema.indexes.push({ model });

          node.arguments.forEach((arg) => {
            const key = arg.name.value;
            const { value: val, values } = arg.value;
            const value = values ? values.map(n => n.value) : val;

            if (name === 'index') schema.indexes[schema.indexes.length - 1][key] = value;

            switch (`${name}-${key}`) {
              case 'model-id': {
                model.idField = value;
                break;
              }
              case 'model-key': {
                model.key = value;
                break;
              }
              case 'model-embed': {
                model.isEmbedded = value;
                break;
              }
              case 'field-key': {
                field.key = value;
                model.keyMap = model.keyMap || {};
                model.keyMap[field.name] = value;
                break;
              }
              case 'field-default': {
                field.defaultValue = value;
                break;
              }
              case 'field-persist': {
                field.isPersistable = value;
                break;
              }
              case 'link-by': {
                field.isVirtual = true;
                break;
              }
              default: {
                if (['validate', 'construct', 'restruct', 'destruct', 'instruct', 'normalize', 'transform', 'serialize', 'deserialize'].includes(key)) {
                  target.pipelines[key] = target.pipelines[key] || [];
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
          const idField = $model.fields[$model.idField];
          $model.primaryKey = Util.nvl(idField?.key, idField?.name, 'id');

          // // Model resolution after field resolution (push)
          // thunks.push(() => {
          // });
        } else if (node.kind === Kind.FIELD_DEFINITION) {
          const $field = field;
          // const $model = model;
          $field.isPrimaryKey = Boolean($field.name === model.idField);
          $field.isPersistable = Util.uvl($field.isPersistable, model.isPersistable, true);

          // Field resolution comes first (unshift)
          thunks.unshift(($schema) => {
            $field.model = $schema.models[$field.type];
            $field.isFKReference = $field.model?.isMarkedModel && !$field.model?.isEmbedded;
            $field.isIdField = Boolean($field.isPrimaryKey || $field.isFKReference);
            if ($field.isIdField) $field.pipelines.serialize.unshift('idField');
            if ($field.isRequired && $field.isPersistable && !$field.isVirtual) $field.pipelines.validate.push('required');
            if ($field.isFKReference) $field.pipelines.validate.push('ensureId'); // Absolute Last
            if ($field.isPrimaryKey && $field.type === 'ID') $field.pipelines.serialize.unshift('idKey'); // Absolute first
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

    // Return schema
    // console.log(schema.models.Person);
    return schema;
  }
};
