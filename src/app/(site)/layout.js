export default function SiteLayout({ children }) {
  return (
    <>
      <header className="h-12">
        <nav className="h-full flex gap-4 items-center mx-4">
          <a href="/">Home</a>
          <a href="/blog">Blog</a>
        </nav>
      </header>
      {children}
    </>
  );
}