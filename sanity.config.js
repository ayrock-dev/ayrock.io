import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";

import { schemaTypes } from "./src/lib/sanity/schema";
import { markdownSchema } from "sanity-plugin-markdown";

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET;

export default defineConfig({
  basePath: "/studio", // <-- important that `basePath` matches the route you're mounting your studio from

  projectId,
  dataset,
  plugins: [
    structureTool(),
    markdownSchema()
  ],
  schema: {
    types: schemaTypes,
  },
});
