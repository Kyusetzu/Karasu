import { useState, type ImgHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * An image that fades in once it has actually decoded.
 *
 * Cover and banner art arrives over the network long after the layout is
 * settled, so it popped into a finished page — the one moment on the detail
 * screen where something appears out of nowhere. Waiting for `load` and easing
 * the opacity turns that into an arrival.
 *
 * The transition is a plain CSS one, so the reduce-motion rules already collapse
 * it: the image still appears the instant it is ready, it just stops fading.
 *
 * `onError` counts as loaded on purpose. A broken URL would otherwise leave a
 * permanently transparent element and, with it, no alt text and no broken-image
 * affordance — failing invisibly is worse than failing visibly.
 */
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
      onLoad={() => setReady(true)}
      onError={() => setReady(true)}
      style={{
        opacity: ready ? loadedOpacity : 0,
        // `land`'s duration on the expo token — a raw curve here drifted the
        // moment the token was ever retuned.
        transition: "opacity 420ms var(--ease-out-expo)",
        ...rest.style,
      }}
      className={cn(className)}
    />
  );
}
