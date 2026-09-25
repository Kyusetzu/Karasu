import { useState, type InputHTMLAttributes } from "react";
import { Input } from "@/components/ui/input";
import { countText, parseCount } from "@/lib/countField";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "min"> & {
  value: number;
  onChange: (value: number) => void;
  max?: number;
};

/** A count field that may be emptied while typing; empty reports 0, and a stored 0 shows as the placeholder. */
export function NumberInput({ value, onChange, max, onFocus, onBlur, ...rest }: Props) {
  // The text as typed, kept only while it still reads as the value the caller holds.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft !== null && parseCount(draft, max) === value ? draft : countText(value);
  return (
    <Input
      placeholder="0"
      {...rest}
      type="number"
      inputMode="numeric"
      min={0}
      max={max}
      value={shown}
      onFocus={(e) => {
        // Selected, so a digit typed into a filled field replaces the count instead of joining it.
        e.currentTarget.select();
        onFocus?.(e);
      }}
      onChange={(e) => {
        const next = parseCount(e.target.value, max);
        if (next === null) return;
        setDraft(e.target.value === "" || String(next) === e.target.value ? e.target.value : String(next));
        onChange(next);
      }}
      onBlur={(e) => {
        setDraft(null);
        onBlur?.(e);
      }}
    />
  );
}
