import { DecodedImage } from "@/components/media/DecodedImage";
import { cn } from "@/lib/utils";

/** A banner shown whole: contained so one axis fills and nothing is cropped or stretched, the rest a blur of itself. */
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
  return (
    <div className={cn("absolute inset-0 overflow-hidden", className)}>
      {/* The fill for whichever axis the banner does not reach; scaled so the blur's soft edge stays off-frame. */}
      <DecodedImage
        src={src}
        aria-hidden
        className={cn("absolute inset-0 h-full w-full scale-110 object-cover", veiled ? "blur-2xl" : "blur-xl")}
        loadedOpacity={opacity * (veiled ? 1 : 0.6)}
      />
      {!veiled && (
        <DecodedImage
          src={src}
          className={cn("absolute inset-0 h-full w-full object-contain", anchor === "top" && "object-top")}
          loadedOpacity={opacity}
        />
      )}
    </div>
  );
}
