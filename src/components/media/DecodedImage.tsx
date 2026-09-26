import { useState, type ImgHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** An image that fades in once loaded; `onError` counts as loaded so a broken URL fails visibly, not transparently. */
export function DecodedImage({
  className,
  loadedOpacity = 1,
  ...rest
}: ImgHTMLAttributes<HTMLImageElement> & {
  /** Final opacity — the blurred cover backdrop sits at 0.4. */
  loadedOpacity?: number;
}) {
  const [ready, setReady] = useState(false);
  return (
    <img
      alt=""
      {...rest}
      onLoad={(e) => {
        setReady(true);
        rest.onLoad?.(e);
      }}
      onError={() => setReady(true)}
      style={{
        opacity: ready ? loadedOpacity : 0,
        // The expo token rather than a raw curve, so a retune of the token cannot leave this drifting.
        transition: "opacity 420ms var(--ease-out-expo)",
        ...rest.style,
      }}
      className={cn(className)}
    />
  );
}
