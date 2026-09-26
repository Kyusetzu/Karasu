import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Minus, Plus } from "lucide-react";
import type { MediaDetail } from "@/api/queries";
import { maxProgress, STATUS_ORDER, type MediaListStatus, type SaveEntryInput } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { IconButton } from "@/components/ui/icon-button";
import { NumberInput } from "@/components/ui/number-input";
import TagEditor from "@/components/media/TagEditor";
import { CommunityScore } from "@/components/media/CommunityScore";
import { Textarea } from "@/components/ui/textarea";
import { statusColorVar } from "@/lib/statusColors";
import { parseNotes, serializeNotes } from "@/lib/tags";
import { cn } from "@/lib/utils";

/** The fields of an entry the quick editor reads; the detail stub and a cached list entry both carry them. */
export interface QuickEntry {
  status: MediaListStatus;
  progress: number;
  score: number;
  repeat: number;
  notes: string | null;
}

export type EntryPatch = Omit<SaveEntryInput, "mediaId">;

/** The detail page's entry editor: status, progress and score save as they are touched; the rest waits for Save. */
export function QuickEditor({
  media,
  entry,
  defaultStatus,
  onStatus,
  onWrite,
}: {
  media: MediaDetail;
  /** Null for a title not on the list, which offers only the status to add it with. */
  entry: QuickEntry | null;
  /** The status an add uses unless another is chosen, marked in place among the others. */
  defaultStatus?: MediaListStatus;
  onStatus: (status: MediaListStatus) => void;
  onWrite: (patch: EntryPatch) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div role="group" aria-label={entry ? t("common.status") : t("detail.addAs")}>
        {!entry && <p className="mb-2 text-sm text-ink-500">{t("detail.addAs")}</p>}
        <div className="grid grid-cols-3 gap-1.5">
          {STATUS_ORDER.map((s) => {
            const current = entry?.status === s;
            const preset = !entry && defaultStatus === s;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={current}
                onClick={() => onStatus(s)}
                className={cn(
                  "flex h-10 min-w-0 items-center gap-2 rounded-control px-2.5 text-left text-xs font-medium transition-surface",
                  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-500",
                  "border",
                  current || preset ? "tint-fill text-ink-100" : "border-surface-700 text-ink-300 hover:border-surface-600 hover:text-ink-100",
                )}
                style={current || preset ? ({ "--tint": statusColorVar(s) } as CSSProperties) : undefined}
              >
                <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: statusColorVar(s) }} />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate">{t(`status.${media.type}.${s}`)}</span>
                  {preset && <span className="truncate text-2xs font-normal text-ink-500">{t("detail.defaultStatus")}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {entry && (
        <>
          <Progress media={media} value={entry.progress} onCommit={(progress) => onWrite({ progress })} />
          <CommunityScore
            value={entry.score}
            onChange={(score) => onWrite({ score })}
            distribution={media.stats?.scoreDistribution}
            average={media.averageScore}
          />
          <More media={media} entry={entry} onSave={onWrite} />
          <p className="text-center text-2xs text-ink-600">{t("detail.quickSaveHint")}</p>
        </>
      )}
    </div>
  );
}

/** The count with a step either side; a step saves at once, a typed count once the field is left. */
function Progress({ media, value, onCommit }: { media: MediaDetail; value: number; onCommit: (n: number) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const total = maxProgress(media);
  const [typed, setTyped] = useState(value);
  // What was last committed or received, so leaving the field unchanged writes nothing.
  const committed = useRef(value);
  useEffect(() => {
    committed.current = value;
    setTyped(value);
  }, [value]);
  const commit = (n: number) => {
    if (n === committed.current) return;
    committed.current = n;
    onCommit(n);
  };
  // Closing the sheet unmounts the field without a blur, so a count typed and not yet left is written on the way out.
  const pending = useRef({ typed, commit });
  pending.current = { typed, commit };
  useEffect(() => () => pending.current.commit(pending.current.typed), []);

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm text-ink-500">
        {media.type === "MANGA" ? t("common.chapters") : t("common.progress")}
      </label>
      <div className="flex items-center gap-2">
        <IconButton
          aria-label={t("detail.progressLess")}
          disabled={value <= 0}
          // From the last commit, not the prop: a typed count committed by this same press's blur is the base.
          onClick={() => commit(Math.max(0, committed.current - 1))}
          className="size-11 rounded-panel border border-surface-700 bg-surface-900 text-ink-100"
        >
          <Minus className="size-4" />
        </IconButton>
        <div className="flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-panel border border-surface-700 bg-surface-950 focus-within:border-accent-500">
          <NumberInput
            id={id}
            value={typed}
            max={total ?? undefined}
            onChange={setTyped}
            onBlur={() => commit(typed)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="h-auto w-14 border-0 bg-transparent px-0 text-right text-lg font-semibold tabular-nums [&::-webkit-inner-spin-button]:appearance-none"
          />
          {total !== null && <span className="text-sm text-ink-500">/ {total}</span>}
        </div>
        <IconButton
          aria-label={t("detail.progressMore")}
          variant="accent"
          disabled={total !== null && value >= total}
          onClick={() => commit(total !== null ? Math.min(total, committed.current + 1) : committed.current + 1)}
          className="size-11 rounded-panel"
        >
          <Plus className="size-4" />
        </IconButton>
      </div>
    </div>
  );
}

/** Rewatches, tags and notes behind a fold, saved together, since a note typed a letter at a time is not a quick edit. */
function More({ media, entry, onSave }: { media: MediaDetail; entry: QuickEntry; onSave: (patch: EntryPatch) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const parsed = parseNotes(entry.notes);
  const [repeat, setRepeat] = useState(entry.repeat);
  const [notes, setNotes] = useState(parsed.notes);
  const [tags, setTags] = useState(parsed.tags);
  const manga = media.type === "MANGA";

  return (
    <div className="rounded-control border border-hair">
      <Disclosure
        summary={manga ? t("detail.moreManga") : t("detail.moreAnime")}
        className="px-3 py-2.5 text-sm text-ink-300 transition-surface hover:text-ink-100"
        panelClassName="space-y-3 border-t border-hair p-3"
      >
        <label className="block text-sm">
          <span className="mb-1 block text-ink-500">{manga ? t("entry.rereads") : t("entry.rewatches")}</span>
          <span className="flex items-center gap-1.5">
            <NumberInput value={repeat} onChange={setRepeat} className="w-20" />
            <Button
              variant="secondary"
              size="icon"
              aria-label={t("entry.addRepeat")}
              title={t("entry.addRepeat")}
              onClick={() => setRepeat((r) => r + 1)}
            >
              +1
            </Button>
          </span>
        </label>
        <div className="text-sm">
          <span id={`${id}-tags`} className="mb-1 block text-ink-500">
            {t("tags.label")}
          </span>
          <TagEditor tags={tags} onChange={setTags} labelledBy={`${id}-tags`} />
        </div>
        <label className="block text-sm">
          <span className="mb-1 block text-ink-500">{t("entry.notes")}</span>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder={t("entry.notesPlaceholder")}
          />
        </label>
        <Button className="w-full" onClick={() => onSave({ repeat, notes: serializeNotes(notes, tags) })}>
          {t("common.save")}
        </Button>
      </Disclosure>
    </div>
  );
}
