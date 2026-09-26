import { useId, type ReactNode } from "react";

/** One labelled control in a form: its label above, then the control, then a hint or, when there is one, the error. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  /** The control's id; without one the label names the children as a group, such as a row of pills. */
  htmlFor?: string;
  hint?: ReactNode;
  /** Replaces the hint while it stands, in the danger ink. */
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const labelId = useId();
  const labelClass = "block text-xs font-medium text-ink-300";
  const note = error ? (
    <p className="mt-1 text-2xs text-danger">{error}</p>
  ) : (
    hint && <p className="mt-1 text-2xs text-ink-600">{hint}</p>
  );
  if (htmlFor)
    return (
      <div className={className}>
        <label htmlFor={htmlFor} className={labelClass}>
          {label}
        </label>
        <div className="mt-1.5">{children}</div>
        {note}
      </div>
    );
  return (
    <div role="group" aria-labelledby={labelId} className={className}>
      <span id={labelId} className={labelClass}>
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
      {note}
    </div>
  );
}
