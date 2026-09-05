import KarasuMark from "@/components/KarasuMark";
import { ButtonLink } from "@/components/ui/button";

/** The page GitHub Pages serves for any path that is not the site. */
export function NotFound() {
  return (
    <main
      id="main"
      className="grid min-h-svh place-items-center px-6 py-16 text-center"
    >
      <div className="flex max-w-md flex-col items-center gap-5">
        <KarasuMark className="size-20" title="Karasu" />
        <p className="font-brand text-2xs font-semibold uppercase tracking-[.18em] text-accent-400">
          404
        </p>
        <h1 className="font-brand text-2xl font-bold tracking-[-.02em] text-ink-100">
          Nothing perched here.
        </h1>
        <p className="text-sm leading-relaxed text-ink-500">
          The page you were looking for does not exist. The whole site is one
          page, and this is not it.
        </p>
        <ButtonLink href={import.meta.env.BASE_URL}>Back to Karasu</ButtonLink>
      </div>
    </main>
  );
}
