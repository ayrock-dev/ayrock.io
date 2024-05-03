import "./globals.css";

export const metadata = {
  title: "Ayrock",
  description:
    "The thoughts and musings of Eric Lee — a web dev, gym rat, and coffee addict.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="bg-black text-white">
      <body className="absolute inset-0 flex flex-col">{children}</body>
    </html>
  );
}
