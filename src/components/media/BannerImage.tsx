import { useRef, useState, type CSSProperties } from "react";
import { DecodedImage } from "@/components/media/DecodedImage";
import { useElementSize } from "@/hooks/useElementSize";
import { edgeBands, featherMask, fitBanner, type Rect, type Side } from "@/lib/bannerFit";
import { cn } from "@/lib/utils";

/** How far a band reaches under the picture, so its blurred edge never shows as a seam. */
const LAP = 10;
/** How wide the picture's own edge fades where a band takes over. */
const FEATHER = 14;

/** A banner shown whole: contained so nothing is cropped or stretched, its edge colours carried into the rest. */
export function BannerImage({
  src,
  veiled = false,
  opacity = 1,
  anchor = "center",
  className,
}: {
  src: string;
  /** The adult blur: only the backdrop draws, so the picture itself never shows through the veil. */
  veiled?: boolean;
  /** For a banner that sits dimmed behind text, like the profile's. */
  opacity?: number;
  /** Where the whole banner rests when the frame is taller than it; "top" keeps text at the foot off the picture. */
  anchor?: "center" | "top";
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const size = useElementSize(box);
  // The picture's own shape, known once it has loaded; until then it draws as a plain contained image.
  const [ratio, setRatio] = useState(0);
  const fit = veiled ? null : fitBanner(size, ratio, anchor);
  const mask = fit ? featherMask(fit, FEATHER) : null;

  return (
    <div ref={box} className={cn("absolute inset-0 overflow-hidden", className)}>
      {/* The corners' wash, and the whole fill before the picture's shape is known; scaled so its soft edge stays off-frame. */}
      <DecodedImage
        src={src}
        aria-hidden
        className={cn("absolute inset-0 h-full w-full scale-110 object-cover", veiled ? "blur-2xl" : "blur-xl")}
        loadedOpacity={opacity * (veiled ? 1 : fit ? 0.35 : 0.6)}
      />
      {fit && edgeBands(fit, LAP).map((band) => <EdgeBand key={band.side} src={src} opacity={opacity} {...band} />)}
      {!veiled && (
        <DecodedImage
          src={src}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth && img.naturalHeight) setRatio(img.naturalWidth / img.naturalHeight);
          }}
          className={cn("absolute inset-0 h-full w-full object-contain", anchor === "top" && "object-top")}
          style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
          loadedOpacity={opacity}
        />
      )}
    </div>
  );
}

/** The picture's outermost rows or columns stretched across a gap: its edge colours go on, and no shape repeats. */
function EdgeBand({ src, side, rect, opacity }: { src: string; side: Side; rect: Rect; opacity: number }) {
  const across = side === "top" || side === "bottom";
  // Gone where it ends under the picture, opaque at the seam, gone again at the frame's edge.
  const fade = `linear-gradient(to ${side}, transparent 0px, #000 ${LAP}px, transparent)`;
  const style: CSSProperties = {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    opacity: 0.85 * opacity,
    maskImage: fade,
    WebkitMaskImage: fade,
    // The same entrance as the picture, so the fill does not arrive a beat before what it continues.
    animation: "fadeIn 420ms var(--ease-out-expo) both",
  };
  return (
    <div aria-hidden className="absolute overflow-hidden" style={style}>
      <div
        className="h-full w-full scale-110 blur-[10px]"
        style={{
          backgroundImage: `url("${src}")`,
          backgroundRepeat: "no-repeat",
          // Stretched so far along the gap that the band shows only the picture's last few pixels at that edge.
          backgroundSize: across ? "100% 2400%" : "2400% 100%",
          backgroundPosition: side,
        }}
      />
    </div>
  );
}
