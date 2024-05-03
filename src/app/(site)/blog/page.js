import dayjs from "dayjs";

import { client } from "@/lib/sanity/client";

export default async function BlogIndex() {
  const blogposts = await client.fetch('*[_type == "blogpost"]');

  return (
    <div className="flex-1 container mx-auto pt-48 px-2">
      <main>
        <h1 className="tracking-tighter text-4xl sm:text-6xl lg:text-8xl font-heading pb-8">
          blog
        </h1>
        <ul className="flex flex-col gap-4">
          {blogposts.map((blogpost) => (
            <li key={blogpost._id}>
              <a className="flex flex-col" href={`/blog/${blogpost?.slug}`}>
                <span>{blogpost?.title}</span>
                <span className="opacity-80">
                  {dayjs(blogpost._createdAt).format("MMMM D, YYYY")}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
