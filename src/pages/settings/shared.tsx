import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { hexToHsv, hsvToHex, type Hsv } from "@/lib/contrast";

/**
 * The controls every settings pane shares.
 *
 * They live here rather than in `components/ui` because none of them is a
 * primitive: the toggle knows what a settings row looks like, and the colour
 * picker exists only because the native `<input type="color">` opens an OS
 * dialog that misbehaves inside the Tauri window.
 */

/** The one select skin, so the four of them cannot drift apart. */
export const SELECT =
  "h-9 rounded-lg border border-surface-700 bg-surface-900 px-2 text-sm focus:border-accent-500 focus:outline-none";

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-1">
      <span>
        <span className="block text-sm text-ink-100">{label}</span>
        {hint && <span className="block text-xs text-ink-600">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-4.75 w-8.5 shrink-0 rounded-full transition-colors",
          checked ? "bg-accent-600" : "bg-surface-700",
        )}
      >
        <span
          className={cn(
            "absolute top-[.0625rem] size-4.25 rounded-full transition-all",
            // The thumb has to hold on both tracks in both themes. White works
            // on the accent fill (600 is the darkened shade in either theme)
            // but disappears on the light theme's pale grey track, where the
            // ink colour — which inverts — is the one that reads.
            checked ? "left-4 bg-white" : "left-[.0625rem] bg-ink-100",
          )}
        />
      </button>
    </label>
  );
}

/** Inline saturation/value + hue picker — replaces the native `<input type="color">`,
 * which spawns an OS-level colour dialog that can misbehave inside the Tauri window. */
export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const validValue = /^#[0-9a-f]{6}$/i.test(value) ? value : "#6c7fff";
  const [hsv, setHsvState] = useState<Hsv>(() => hexToHsv(validValue));
  const hsvRef = useRef(hsv);
  const [hexInput, setHexInput] = useState(validValue);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  // Stay in sync if the accent changes from outside (e.g. a preset click).
  useEffect(() => {
    const next = hexToHsv(validValue);
    hsvRef.current = next;
    setHsvState(next);
    setHexInput(validValue);
  }, [validValue]);

  const commit = (next: Hsv) => {
    hsvRef.current = next;
    setHsvState(next);
    const hex = hsvToHex(next);
    setHexInput(hex);
    onChange(hex);
  };

  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

  const beginDrag = (
    el: HTMLDivElement,
    e: React.PointerEvent,
    compute: (x: number, y: number, rect: DOMRect) => Hsv,
  ) => {
    el.setPointerCapture(e.pointerId);
    const apply = (x: number, y: number) =>
      commit(compute(x, y, el.getBoundingClientRect()));
    apply(e.clientX, e.clientY);
    const onMove = (ev: PointerEvent) => apply(ev.clientX, ev.clientY);
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  };

  return (
    <div className="space-y-2 rounded-lg border border-surface-700 bg-surface-900 p-3">
      <div
        ref={svRef}
        onPointerDown={(e) =>
          svRef.current &&
          beginDrag(svRef.current, e, (x, y, rect) => ({
            h: hsvRef.current.h,
            s: clamp01((x - rect.left) / rect.width) * 100,
            v: 100 - clamp01((y - rect.top) / rect.height) * 100,
          }))
        }
        className="relative h-28 w-full touch-none rounded-md"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h}, 100%, 50%))`,
        }}
      >
        <div
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }}
        />
      </div>

      <div
        ref={hueRef}
        onPointerDown={(e) =>
          hueRef.current &&
          beginDrag(hueRef.current, e, (x, _y, rect) => ({
            h: clamp01((x - rect.left) / rect.width) * 360,
            s: hsvRef.current.s,
            v: hsvRef.current.v,
          }))
        }
        className="relative h-3 w-full touch-none rounded-full"
        style={{
          background:
            "linear-gradient(to right, red, yellow, lime, cyan, blue, magenta, red)",
        }}
      >
        <div
          className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{ left: `${(hsv.h / 360) * 100}%` }}
        />
      </div>

      <input
        type="text"
        value={hexInput}
        onChange={(e) => setHexInput(e.target.value)}
        onBlur={() => {
          if (/^#[0-9a-f]{6}$/i.test(hexInput)) commit(hexToHsv(hexInput));
          else setHexInput(hsvToHex(hsv));
        }}
        spellCheck={false}
        maxLength={7}
        className="w-full rounded-md border border-surface-700 bg-surface-850 px-2 py-1 font-mono text-xs uppercase focus:border-accent-500 focus:outline-none"
      />
    </div>
  );
}
