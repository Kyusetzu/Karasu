import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Shared back control for pages reached only from elsewhere, filled and blurred so it stays readable on banner art. */
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
