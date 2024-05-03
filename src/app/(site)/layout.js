import React from "react";
import { UseFathom } from "@/lib/use-fathom";

export default function SiteLayout({ children }) {
  return (
    <React.Suspense
      fallback={
        <main className="flex flex-1 items-center justify-center">
          <span>Loading...</span>
        </main>
      }
    >
      <UseFathom />
      <header className="h-12">
        <nav className="h-full flex gap-4 items-center mx-4">
          <a href="/">Home</a>
          <a href="/blog">Blog</a>
        </nav>
      </header>
      {children}
    </React.Suspense>
  );
}
