const FS = require('fs');
const { Kind, print, parse, visit, isSchema } = require('graphql');

module.exports = class Schema {
  #gql;

  constructor(mixed) {
    if (isSchema(mixed)) this.#gql = print(mixed);
    else if (FS.statSync(mixed)) this.#gql = FS.readFileSync(mixed, 'utf8');
    else this.#gql = mixed;
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
          model = schema.models[name] = { name, fields: {} };
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
          const target = isField ? field : model;
          target.directives = target.directives || {};
          target.directives[node.name.value] = node.arguments.reduce((prev, arg) => {
            const key = arg.name.value;
            const { value } = arg.value;

            if (isField && key === 'key') {
              model.keyMap = model.keyMap || {};
              model.keyMap[field.name] = value;
            }

            return Object.assign(prev, { [key]: value });
          }, {});
        }

        return undefined; // Continue
      },
      leave: (node) => {
        if (node.kind === Kind.FIELD_DEFINITION) isField = false;
        if (node.kind === Kind.LIST_TYPE) isList = false;
      },
    });

    return schema;
  }
};
