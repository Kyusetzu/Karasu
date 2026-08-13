import { useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/social/Markdown";
import { useUpdateUser } from "@/hooks/useUpdateUser";
import { charsLeft, POST_MAX } from "@/lib/composer";
import {
  isNamedColor,
  normalizeProfileColor,
  PROFILE_COLOR_HEX,
  PROFILE_COLORS,
  profileColorSwatch,
} from "@/lib/profileColor";
import { cn } from "@/lib/utils";

/**
 * The bio and the profile colour.
 *
 * These are the two AniList account settings that are *not* in the settings
 * pane, and the axis is not "presentation versus configuration" — it is **set
 * once versus composed**. A bio is written next to a preview of itself; a colour
 * is picked while looking at what it colours. Neither has a stable correct value
 * you set and forget, which is what everything in the pane does have.
 *
 * That also matches the app's own precedent: composition editing happens in a
 * modal here (`EntryEditModal`, the tag editor), not in Settings.
 *
 * The live preview is the only place anyone learns which markdown Karasu
 * renders — an image becomes a chip here exactly as it will on the profile.
 */
export function ProfileEditModal({
  viewerName,
  about,
  profileColor,
  onClose,
  leaving,
}: {
  viewerName: string;
  about: string | null;
  profileColor: string | null;
  onClose: () => void;
  leaving?: boolean;
}) {
  const { t } = useTranslation();
  const save = useUpdateUser(viewerName);
  const [draft, setDraft] = useState(about ?? "");
  const [color, setColor] = useState(profileColor ?? "");
  const [hex, setHex] = useState(isNamedColor(profileColor) ? "" : (profileColor ?? ""));

  const normalColor = normalizeProfileColor(color);
  const swatch = profileColorSwatch(color);
  const left = charsLeft(draft);
  const tooLong = left < 0;

  const dirty = draft !== (about ?? "") || normalColor !== normalizeProfileColor(profileColor);

  const submit = () => {
    if (!dirty || tooLong || save.isPending) return;
    save.mutate(
      {
        ...(draft !== (about ?? "") ? { about: draft } : {}),
        ...(normalColor !== normalizeProfileColor(profileColor) && normalColor
          ? { profileColor: normalColor }
          : {}),
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal
      title={t("social.editProfile")}
      onClose={onClose}
      leaving={leaving}
      className="max-w-2xl"
    >
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-ink-300" htmlFor="bio">
            {t("social.bio")}
          </label>
          {/* Editor and preview side by side, so the markdown is learned rather
              than guessed at. */}
          <div className="mt-1.5 grid gap-3 sm:grid-cols-2">
            <textarea
              id="bio"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("social.bioPlaceholder")}
              rows={10}
              className="min-h-44 w-full resize-y rounded-lg border border-surface-700 bg-surface-950 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
            />
            <div className="min-h-44 overflow-y-auto rounded-lg border border-surface-800 bg-surface-950 p-3">
              {draft.trim() ? (
                <Markdown source={draft} />
              ) : (
                <p className="text-xs text-ink-600">{t("social.bioPreviewEmpty")}</p>
              )}
            </div>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <p className="text-2xs text-ink-600">{t("social.bioMarkdownHint")}</p>
            {left < POST_MAX * 0.15 && (
              <span className={cn("text-2xs tabular-nums", tooLong ? "text-danger" : "text-ink-600")}>
                {left}
              </span>
            )}
          </div>
        </div>

        <div>
          <span className="block text-xs font-medium text-ink-300">
            {t("social.profileColor")}
          </span>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {PROFILE_COLORS.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setColor(name);
                  setHex("");
                }}
                aria-label={name}
                aria-pressed={normalColor === name}
                className={cn(
                  "size-7 rounded-full border-2 transition-surface",
                  normalColor === name ? "border-ink-100" : "border-transparent",
                )}
                style={{ backgroundColor: PROFILE_COLOR_HEX[name] }}
              />
            ))}
            {/* Hex is a supporter feature on AniList's side. Karasu offers the
                field and lets AniList decide, rather than guessing at tiers. */}
            <Input
              value={hex}
              onChange={(e) => {
                setHex(e.target.value);
                setColor(e.target.value);
              }}
              placeholder="#RRGGBB"
              spellCheck={false}
              maxLength={7}
              className="h-7 w-24 font-mono text-xs"
            />
            {swatch && (
              <span
                className="size-7 shrink-0 rounded-full border border-surface-700"
                style={{ backgroundColor: swatch }}
                aria-hidden="true"
              />
            )}
          </div>
          {color.trim() && !normalColor && (
            <p className="mt-1 text-2xs text-danger">{t("social.colorInvalid")}</p>
          )}
          <p className="mt-1 text-2xs text-ink-600">{t("social.profileColorHint")}</p>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-surface-800 pt-3">
          {/* Cross-link, so no field lives in two places and each says where the
              others are. */}
          <Link
            to="/settings?pane=anilist"
            className="text-xs text-accent-400 hover:underline"
          >
            {t("social.otherAccountSettings")}
          </Link>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" onClick={submit} disabled={!dirty || tooLong || save.isPending}>
              {save.isPending ? t("social.saving") : t("common.save")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
