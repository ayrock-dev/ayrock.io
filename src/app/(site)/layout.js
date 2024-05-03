import Link from "next/link";
import React from "react";
import { Github, Twitter } from "lucide-react";

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
      <Header />
      {children}
    </React.Suspense>
  );
}

function Header() {
  return (
    <header className="fixed top-0 inset-x-0 h-16 mx-4 mt-4">
      <nav className="rounded-lg h-full flex gap-2 items-center justify-center mx-4 p-4">
        <Navlink href="/">home</Navlink>
        <Navlink href="/blog">blog</Navlink>
        <Navlink href="https://x.com/ItsAyrock">
          <Twitter className="h-4 w-4" />
        </Navlink>
        <Navlink href="https://github.com/ayrock-dev">
          <Github className="h-4 w-4" />
        </Navlink>
      </nav>
    </header>
  );
}

function Navlink(props) {
  return <Link className="flex items-center h-full px-2" {...props} />;
}
