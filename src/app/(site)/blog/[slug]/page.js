import dayjs from "dayjs";
import MarkdownRenderer from "react-markdown-renderer";
import { notFound } from "next/navigation";

import { client } from "@/lib/sanity/client";

export default async function BlogPost({ params }) {
  const blogpost = await client.fetch(
    '*[_type == "blogpost" && slug == $slug][0]',
    { slug: params.slug }
  );

  if (!blogpost) {
    notFound();
  }

  return (
    <div className="flex-1 container mx-auto pt-48 px-2">
      <main>
        <h1 className="font-heading tracking-tighter text-4xl sm:text-6xl lg:text-8xl pb-8">
          {blogpost?.title}
        </h1>
        <h2 className="font-heading text-xl sm:text-2xl lg:text-2xl opacity-80 pb-4">
          {dayjs(blogpost._createdAt).format("MMMM D, YYYY")}
        </h2>
        {blogpost.content && <MarkdownRenderer markdown={blogpost.content} />}
      </main>
    </div>
  );
}
