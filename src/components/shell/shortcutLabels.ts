import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { PaletteShortcutId, ShortcutId, ShortcutScope } from "@/lib/shortcuts";

/** The one place a shortcut becomes words; a literal switch, so the i18n key test sees every label it can return. */
export function useShortcutLabels(): {
  label: (id: ShortcutId) => string;
  scope: (scope: ShortcutScope) => string;
  /** Worded for where it is read: inside the open palette its own key closes it, and sync says what its row says. */
  inPalette: (id: PaletteShortcutId) => string;
} {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      label: (id: ShortcutId) => {
        switch (id) {
          case "palette":
            return t("keys.palette");
          case "reference":
            return t("keys.reference");
          case "search":
            return t("keys.search");
          case "close":
            return t("keys.close");
          case "overview":
            return t("keys.overview");
          case "anime":
            return t("keys.anime");
          case "manga":
            return t("keys.manga");
          case "sync":
            return t("keys.sync");
          case "zoomIn":
            return t("keys.zoomIn");
          case "zoomOut":
            return t("keys.zoomOut");
          case "zoomReset":
            return t("keys.zoomReset");
          case "findInList":
            return t("keys.findInList");
          case "move":
            return t("keys.move");
          case "open":
            return t("keys.open");
          case "plusOne":
            return t("keys.plusOne");
          case "edit":
            return t("keys.edit");
          case "complete":
            return t("keys.complete");
          case "remove":
            return t("keys.remove");
          case "selectMode":
            return t("keys.selectMode");
          case "selectAll":
            return t("keys.selectAll");
          case "extend":
            return t("keys.extend");
          case "bold":
            return t("keys.bold");
          case "italic":
            return t("keys.italic");
          case "strike":
            return t("keys.strike");
          case "spoiler":
            return t("keys.spoiler");
          case "send":
            return t("keys.send");
        }
      },
      inPalette: (id: PaletteShortcutId) => {
        switch (id) {
          case "findInList":
            return t("keys.findInList");
          case "sync":
            return t("sync.button");
          case "reference":
            return t("keys.reference");
          case "palette":
            return t("palette.keyClose");
        }
      },
      scope: (scope: ShortcutScope) => {
        switch (scope) {
          case "global":
            return t("keys.global");
          case "inList":
            return t("keys.inList");
          case "inComposer":
            return t("keys.inComposer");
        }
      },
    }),
    [t],
  );
}
