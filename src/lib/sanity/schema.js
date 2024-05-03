export const schemaTypes = [
  {
    title: "Ayrock.io Blog Post",
    name: "blogpost",
    type: "document",
    fields: [
      {
        title: "Title",
        name: "title",
        type: "string",
        validation: (Rule) => Rule.required(),
      },
      {
        title: "Slug",
        name: "slug",
        type: "string",
        validation: (Rule) => Rule.required(),
        options: {
          source: "title",
          maxLength: 96,
        },
      },
      {
        name: "content",
        title: "Content",
        type: "markdown",
      },
    ],
  },
];
