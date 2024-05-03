import "./globals.css";

export const metadata = {
  title: "Ayrock",
  description:
    "The thoughts and musings of Eric Lee — a web dev, gym rat, and coffee addict.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="absolute inset-0 flex flex-col">
        <header className="h-12">
          <nav className="h-full flex gap-4 items-center mx-4">
            <a href="/">Home</a>
            <a href="/blog">Blog</a>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
