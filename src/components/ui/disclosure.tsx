import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { usePresence } from "@/hooks/usePresence";
import { cn } from "@/lib/utils";

/** The body of a disclosure, mounted while open and through its exit, growing to its content's height as it arrives. */
export function DisclosurePanel({
  open,
  id,
  className,
  children,
}: {
  open: boolean;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  const { mounted, leaving } = usePresence(open);
  // Open from the first render is where the page starts, not an opening, so it appears without growing.
  const [instant, setInstant] = useState(open);
  if (instant && !open) setInstant(false);
  if (!mounted) return null;
  return (
    <div
      id={id}
      className="disclosure-panel"
      data-instant={instant || undefined}
      data-leaving={leaving || undefined}
      inert={leaving || undefined}
    >
      {/* The clip reaches past the content by the focus ring's width, so a ring on an edge control is not cut off. */}
      <div className="-m-1.5 min-h-0 overflow-hidden p-1.5">
        <div className={className}>{children}</div>
      </div>
    </div>
  );
}

/** A heading row that opens and closes the section under it; open state is the caller's when it passes `open`. */
export function Disclosure({
  summary,
  open: controlled,
  onOpenChange,
  defaultOpen = false,
  className,
  panelClassName,
  children,
}: {
  summary: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  className?: string;
  panelClassName?: string;
  children: ReactNode;
}) {
  const id = useId();
  const [own, setOwn] = useState(defaultOpen);
  const open = controlled ?? own;
  const toggle = () => {
    if (controlled === undefined) setOwn(!open);
    onOpenChange?.(!open);
  };

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
        className={cn("flex w-full items-center justify-between gap-2 text-left", className)}
      >
        {summary}
        <ChevronDown
          aria-hidden
          className={cn("size-4 shrink-0 text-ink-500 transition-transform", open && "rotate-180")}
        />
      </button>
      <DisclosurePanel open={open} id={id} className={panelClassName}>
        {children}
      </DisclosurePanel>
    </>
  );
}
