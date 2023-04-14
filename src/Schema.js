const FS = require('fs');
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
    const schema = { models: {} };
    const operations = ['Query', 'Mutation', 'Subscription'];
    const modelKinds = [Kind.OBJECT_TYPE_DEFINITION, Kind.OBJECT_TYPE_EXTENSION, Kind.INTERFACE_TYPE_DEFINITION, Kind.INTERFACE_TYPE_EXTENSION];
    const allowedKinds = modelKinds.concat(Kind.DOCUMENT, Kind.FIELD_DEFINITION, Kind.NON_NULL_TYPE, Kind.NAMED_TYPE, Kind.LIST_TYPE, Kind.DIRECTIVE);

    visit(parse(this.#gql), {
      enter: (node) => {
        if (!allowedKinds.includes(node.kind)) return false;

        if (modelKinds.includes(node.kind) && !operations.includes(node.name.value)) {
          const name = node.name.value;
          model = schema.models[name] = { name, pk: 'id', fields: {} };
        } else if (node.kind === Kind.FIELD_DEFINITION) {
          const name = node.name.value;
          field = model.fields[name] = { name };
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

          node.arguments.forEach((arg) => {
            const key = arg.name.value;
            const { value } = arg.value;

            switch (`${name}-${key}`) {
              case 'model-id': {
                model.pk = value;
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
              default: {
                if (['validate', 'construct', 'restruct', 'destruct', 'instruct', 'normalize', 'transform', 'serialize', 'deserialize'].includes(key)) {
                  target.pipelines = target.pipelines || {};
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
        if (node.kind === Kind.FIELD_DEFINITION) {
          isField = false;

          // // IDs (first - shift)
          // if (isPrimaryKeyId && type === 'ID') $structures.serializers.unshift(Pipeline.idKey);
          // if (isIdField) $structures.$serializers.unshift(Pipeline.idField);

          // // Required (last - push)
          // if (isRequired && isPersistable && !isVirtual) $structures.validators.push(Pipeline.required);
          // if (modelRef && !isEmbedded) $structures.validators.push(Pipeline.ensureId);

          // // Define target mapping
          // field.pipelines.doc = ['defaultValue', 'castValue', 'ensureArrayValue', 'normalizers', 'instructs', ...crudKeys, `$${serdes}rs`, `${serdes}rs`, 'transforms'];
          // field.pipelines.input = ['defaultValue', 'castValue', 'ensureArrayValue', 'normalizers', 'instructs', ...crudKeys, `$${serdes}rs`, `${serdes}rs`, 'transforms'];
          // field.pipelines.where = ['castValue', 'instructs', `$${serdes}rs`];
        } else if (node.kind === Kind.LIST_TYPE) {
          isList = false;
        }
      },
    });

    return schema;
  }
};
