import { client } from "@/lib/sanity/client";

export default async function BlogIndex() {
  const blogposts = await client.fetch(`*[_type == "blogpost"]`);

  return (
    <main className="flex flex-1 items-center justify-center">
      <ul>
        {blogposts.map((blogpost) => (
          <li key={blogpost._id}>
            <a href={`/blog/${blogpost?.slug}`}>{blogpost?.title}</a>
          </li>
        ))}
      </ul>
    </main>
  );
}
