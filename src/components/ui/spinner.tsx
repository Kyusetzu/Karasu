import { RefreshCw, type LucideIcon, type LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";

/** An icon that turns while something is busy and holds still otherwise; the one place anything spins. */
export function Spinner({
  icon: Icon = RefreshCw,
  spinning = true,
  className,
  ...rest
}: LucideProps & {
  /** The glyph that turns; the sync arrow unless the action has its own. */
  icon?: LucideIcon;
  spinning?: boolean;
}) {
  return <Icon aria-hidden {...rest} className={cn(spinning && "animate-spin", className)} />;
}
