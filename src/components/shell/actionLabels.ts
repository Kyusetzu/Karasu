import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ACTION_LABEL_KEY, type Action } from "@/lib/actions";
import { useScoreFormat } from "@/stores/auth";
import { formatScore } from "@/lib/scoreFormat";
import type { MediaType } from "@/api/types";

/** The one place an `Action` becomes words, so the menu and the sheet never phrase the same thing differently. */
export function useActionLabel(): (action: Action, mediaType: MediaType) => string {
  const { t } = useTranslation();
  const format = useScoreFormat();
  // Stable, so a memo that lists it as a dependency is not rebuilt on every render of its host.
  return useCallback(
    (action: Action, mediaType: MediaType) => {
      // A leaf's label is the value it would write, not a key: a score has no phrase to translate.
      if (action.arg?.kind === "status") return t(`status.${mediaType}.${action.arg.status}`);
      if (action.arg?.kind === "score") return formatScore(format, action.arg.score);
      return t(ACTION_LABEL_KEY[action.id]);
    },
    [t, format],
  );
}
