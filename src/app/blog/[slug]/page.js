import { client } from "@/lib/sanity/client";

export default async function BlogPost({ params }) {
  const blogpost = await client.fetch('*[_type == "blogpost" && slug == $slug][0]', { slug: params.slug });

  return (
    <main className="flex flex-1 items-center justify-center">
      <p>{blogpost?.content}</p>
    </main>
  );
}
