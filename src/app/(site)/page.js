export default function Home() {
  return (
    <div className="flex-1 container mx-auto pt-48 px-2">
      <main>
        <h1 className="tracking-tighter text-4xl sm:text-6xl lg:text-8xl font-heading pb-8">
          hi, I&apos;m Ayrock
        </h1>
        <p className="sm:text-lg lg:text-xl">
          My name is Eric Lee. I&apos;m a web dev, gym goer, and coffee addict.
          I currently work at <a href="https://x.com/stripe">Stripe.</a>
        </p>
      </main>
    </div>
  );
}
