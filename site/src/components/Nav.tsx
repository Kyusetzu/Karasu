import { useCallback, useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import KarasuMark from "@/components/KarasuMark";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { usePresence } from "@/lib/usePresence";
import { LINKS, NAV } from "@/site.config";

/**
 * The sticky top bar. One accent marker slides under the active anchor, the
 * sidebar's own recipe (280 ms `--ease-out-expo`), driven by which section
 * is nearest the top. Below `md` the anchors move into a sheet with the
 * Download button at its foot; the sheet traps focus and closes on Escape.
 */
export function Nav() {
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const { mounted, leaving } = usePresence(open);
  const list = useRef<HTMLUListElement>(null);
  const marker = useRef<HTMLSpanElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  // Which section is on screen: the last one whose top has passed the nav.
  useEffect(() => {
    const sections = NAV.map((n) => document.getElementById(n.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (!sections.length) return;
    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        let best: string | null = null;
        let bestRatio = 0;
        for (const s of sections) {
          const r = visible.get(s.id) ?? 0;
          if (r > bestRatio) {
            best = s.id;
            bestRatio = r;
          }
        }
        setActive(best);
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: [0, 0.1, 0.25, 0.5] },
    );
    for (const s of sections) io.observe(s);
    return () => io.disconnect();
  }, []);

  // Move the marker under the active anchor.
  useEffect(() => {
    const ul = list.current;
    const m = marker.current;
    if (!ul || !m) return;
    const a = active ? ul.querySelector<HTMLAnchorElement>(`a[href="#${active}"]`) : null;
    if (!a) {
      m.style.opacity = "0";
      return;
    }
    const ur = ul.getBoundingClientRect();
    const ar = a.getBoundingClientRect();
    m.style.opacity = "1";
    m.style.left = `${ar.left - ur.left + 12}px`;
    m.style.width = `${ar.width - 24}px`;
  }, [active]);

  const close = useCallback(() => setOpen(false), []);

  // The sheet: Escape closes, Tab stays inside, focus returns to the toggle.
  useEffect(() => {
    // Keyed on `mounted` too: the sheet renders one tick after `open` flips.
    if (!open || !mounted) return;
    const root = sheet.current;
    const focusables = () =>
      Array.from(
        root?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [],
      );
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        toggle.current?.focus();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = "";
    };
  }, [open, mounted, close]);

  return (
    <header className="sticky top-0 z-40 border-b border-hair bg-surface-950/95">
      <nav aria-label="Primary" className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
        <a href="#top" className="flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-accent-500" aria-label="Karasu — back to top">
          <KarasuMark className="size-6" />
          <span className="font-brand text-xs font-semibold tracking-[.2em] text-ink-300">KARASU</span>
        </a>

        <ul ref={list} className="relative hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={active === item.id ? "location" : undefined}
                className={cn(
                  "block rounded-lg px-3 py-1.5 text-[.8125rem] font-medium transition-surface hover:bg-surface-850 hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-accent-500",
                  active === item.id ? "text-ink-100" : "text-ink-500",
                )}
              >
                {item.label}
              </a>
            </li>
          ))}
          <span
            ref={marker}
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-[calc(theme(spacing.14)/2-theme(spacing.5)+1px)] h-0.5 rounded-full bg-accent-500 opacity-0 transition-[left,width,opacity] duration-(--duration-expressive) ease-(--ease-out-expo)"
          />
        </ul>

        <div className="flex items-center gap-2">
          <ButtonLink href={LINKS.repo} variant="ghost" size="sm" className="hidden md:inline-flex">
            GitHub
          </ButtonLink>
          <ButtonLink href={LINKS.latest} size="sm">
            Download
          </ButtonLink>
          <button
            ref={toggle}
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            className="grid size-9 place-items-center rounded-lg text-ink-300 transition-surface hover:bg-surface-850 hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-accent-500 md:hidden"
          >
            {open ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
          </button>
        </div>
      </nav>

      {mounted && (
        <div
          ref={sheet}
          id="mobile-menu"
          data-overlay
          className={cn(
            "absolute inset-x-2 top-[calc(100%+.5rem)] rounded-2xl border border-surface-700 bg-surface-900 p-3 shadow-[0_1rem_3rem_rgba(0,0,0,.6)] md:hidden",
            leaving ? "animate-rise-out" : "animate-rise-in",
          )}
        >
          <ul className="flex flex-col">
            {NAV.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  onClick={close}
                  className="block rounded-lg px-3 py-2.5 text-[.9375rem] font-medium text-ink-300 transition-surface hover:bg-surface-850 hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-accent-500"
                >
                  {item.label}
                </a>
              </li>
            ))}
            <li>
              <a
                href={LINKS.repo}
                className="block rounded-lg px-3 py-2.5 text-[.9375rem] font-medium text-ink-300 transition-surface hover:bg-surface-850 hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-accent-500"
              >
                GitHub
              </a>
            </li>
          </ul>
          <ButtonLink href={LINKS.latest} size="lg" className="mt-2 w-full">
            Download Karasu
          </ButtonLink>
        </div>
      )}
    </header>
  );
}
