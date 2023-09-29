module.exports = {
  decorators: {
    default: `
      id: ID! @field(key: "_id")
      createdAt: Date @field(finalize: createdAt, crud: r)
      updatedAt: Date @field(finalize: [timestamp, toDate], crud: r)
    `,
  },
};
