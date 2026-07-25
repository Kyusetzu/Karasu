import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Shared back control for the two pages you can only arrive at from somewhere
 * else (media detail, franchise graph). Everything reachable from the sidebar
 * is a top-level destination and deliberately has none.
 *
 * It carries a visible label rather than a bare glyph, and a bordered,
 * translucent-blurred fill so it stays readable on the detail page, where it
 * sits directly on banner artwork of unpredictable brightness.
 */
export default function BackButton({ className }: { className?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => navigate(-1)}
      className={cn(
        "gap-1.5 border border-surface-700 bg-surface-900/80 shadow-lg backdrop-blur-sm",
        "hover:bg-surface-800",
        className,
      )}
    >
      <ArrowLeft className="size-3.5" />
      {t("detail.back")}
    </Button>
  );
}
