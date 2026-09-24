import { maxProgress, type MediaListStatus, type MediaType, type SaveEntryInput } from "@/api/types";

/** What a completion can know about a title: its run length, and for manga the volume count as a second axis. */
export interface CompletionMedia {
  type?: MediaType;
  episodes: number | null;
  chapters?: number | null;
  volumes?: number | null;
}

/** The fields "completed" implies; an unknown total fills nothing, so the user's own number stands. */
export interface CompletionFill {
  progress?: number;
  progressVolumes?: number;
}

/** The totals a completed entry carries; volumes only for manga, since AniList would store them on a TV series too. */
export function completionFill(media: CompletionMedia, mediaType?: MediaType): CompletionFill {
  const out: CompletionFill = {};
  const max = maxProgress(media);
  if (max !== null && max > 0) out.progress = max;
  const manga = (mediaType ?? media.type) === "MANGA";
  if (manga && media.volumes != null && media.volumes > 0) out.progressVolumes = media.volumes;
  return out;
}

/** Fills what a move into COMPLETED left out, so a typed number wins and re-saving a finished entry rewrites nothing. */
export function withCompletion<T extends Pick<SaveEntryInput, "status" | "progress" | "progressVolumes">>(
  input: T,
  media: CompletionMedia | null | undefined,
  mediaType?: MediaType,
  /** The entry's status before this write; null or undefined for a first add. */
  from?: MediaListStatus | null,
): T {
  if (input.status !== "COMPLETED" || from === "COMPLETED" || !media) return input;
  const fill = completionFill(media, mediaType);
  const out = { ...input };
  if (out.progress === undefined && fill.progress !== undefined) out.progress = fill.progress;
  if (out.progressVolumes === undefined && fill.progressVolumes !== undefined) {
    out.progressVolumes = fill.progressVolumes;
  }
  return out;
}

/** A bulk selection split by the totals it implies; entries already completed join the group that fills nothing. */
export function completionGroups<E extends { media: CompletionMedia; status?: MediaListStatus }>(
  entries: readonly E[],
  mediaType?: MediaType,
): { fill: CompletionFill; entries: E[] }[] {
  const groups = new Map<string, { fill: CompletionFill; entries: E[] }>();
  for (const entry of entries) {
    const fill = entry.status === "COMPLETED" ? {} : completionFill(entry.media, mediaType);
    const key = `${fill.progress ?? ""}|${fill.progressVolumes ?? ""}`;
    const group = groups.get(key);
    if (group) group.entries.push(entry);
    else groups.set(key, { fill, entries: [entry] });
  }
  return [...groups.values()];
}

/** Above this many requests a bulk completion asks first, since they come out of the one shared per-minute budget. */
export const COMPLETION_CONFIRM_REQUESTS = 5;

/** One bulk patch as the requests it takes: a bare COMPLETED splits by totals, anything else stays one request. */
export function splitBulkPatch<
  E extends { media: CompletionMedia; status?: MediaListStatus },
  P extends Pick<SaveEntryInput, "status" | "progress" | "progressVolumes">,
>(entries: readonly E[], patch: P, mediaType?: MediaType): { entries: E[]; patch: P }[] {
  if (patch.status !== "COMPLETED" || patch.progress !== undefined) {
    return entries.length ? [{ entries: [...entries], patch }] : [];
  }
  return completionGroups(entries, mediaType).map((group) => ({
    entries: group.entries,
    patch: { ...patch, ...group.fill },
  }));
}

/** An editor's status and the two numbers "completed" can fill. */
export interface StatusFields {
  status: MediaListStatus;
  progress: number;
  volumes: number;
}

/** What a fill replaced, so leaving COMPLETED again before saving can put the user's numbers back. */
export interface FillMemo {
  before: { progress: number; volumes: number };
  filled: { progress: number; volumes: number };
}

/** A status pill's effect on the form: COMPLETED shows the totals, and leaving it undoes an untouched fill. */
export function chooseStatus(
  fields: StatusFields,
  memo: FillMemo | null,
  next: MediaListStatus,
  media: CompletionMedia,
  mediaType?: MediaType,
): { fields: StatusFields; memo: FillMemo | null } {
  if (next === "COMPLETED") {
    const fill = completionFill(media, mediaType);
    const filled = {
      progress: fill.progress ?? fields.progress,
      volumes: fill.progressVolumes ?? fields.volumes,
    };
    const changed = filled.progress !== fields.progress || filled.volumes !== fields.volumes;
    return {
      fields: { status: next, ...filled },
      memo: changed ? { before: { progress: fields.progress, volumes: fields.volumes }, filled } : memo,
    };
  }
  const untouched =
    memo !== null &&
    fields.progress === memo.filled.progress &&
    fields.volumes === memo.filled.volumes;
  return {
    fields: untouched ? { status: next, ...memo.before } : { ...fields, status: next },
    memo: null,
  };
}

/** An editor's opening fields: the entry's own numbers, or for a first add its default status as if that pill was picked. */
export function openingFields(
  existing: StatusFields | null,
  status: MediaListStatus,
  media: CompletionMedia,
  mediaType?: MediaType,
): { fields: StatusFields; memo: FillMemo | null } {
  if (existing) return { fields: existing, memo: null };
  return chooseStatus({ status: "PLANNING", progress: 0, volumes: 0 }, null, status, media, mediaType);
}
