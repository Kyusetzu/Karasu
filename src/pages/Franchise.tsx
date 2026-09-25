import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Minus, Plus } from "lucide-react";
import { loadFranchise, type FranchiseNode } from "@/api/franchise";
import { useContentFilter } from "@/stores/contentFilter";
import { useAuth } from "@/stores/auth";
import { showToast } from "@/stores/toast";
import { isTauri } from "@/api/anilist";
import { formatLabel } from "@/lib/format";
import {
  COVER_H,
  layoutFranchise,
  NODE_H,
  NODE_W,
  type FranchiseTreeNode,
} from "@/lib/franchiseLayout";
import { BUTTON_STEP, usePanZoom } from "@/hooks/usePanZoom";
import { centerOn } from "@/lib/zoomMath";
import { useCachedEntry } from "@/hooks/useCachedEntry";
import { useListMutations } from "@/hooks/useListMutations";
import { displayTitle, STATUS_ORDER, type MediaListStatus, type MediaType } from "@/api/types";
import BackButton from "@/components/shell/BackButton";
import EntryEditModal from "@/components/media/EntryEditModal";
import { Presence } from "@/components/ui/presence";
import { EmptyState, PerchRule } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { IconButton } from "@/components/ui/icon-button";
import { cardClass } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { statusColorVar } from "@/lib/statusColors";
import { loadLegendOpen, saveLegendOpen } from "@/lib/franchiseLegend";

/** List status → node outline, from `lib/statusColors` so cover rings and this graph never disagree. */
const colorOf = statusColorVar;

/** Planning and not-on-list are near-identical greys, so an untracked title is drawn dashed instead. */
const outline = (status: MediaListStatus | null) =>
  `2px ${status ? "solid" : "dashed"} ${colorOf(status)}`;

/** Every status has its own colour in the user's palette, so the key names all six and the untracked dashed ring. */
const LEGEND: (MediaListStatus | null)[] = [...STATUS_ORDER, null];

export default function Franchise() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const rootId = Number(id);

  const level = useContentFilter((s) => s.level);
  const filterReady = useContentFilter((s) => s.ready);
  // `?? 0` like every other screen: local mode keys the list under 0, so undefined hides every local entry.
  const userId = useAuth((s) => s.viewer?.id) ?? 0;

  const { data, isLoading, error } = useQuery({
    queryKey: ["franchise", rootId, level],
    queryFn: () => loadFranchise(rootId, level),
    enabled: isTauri && filterReady && Number.isFinite(rootId),
    // Keep `gcTime` with `staleTime` or navigating away drops the costliest fetch; longer shows yesterday's list status.
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });

  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);

  const viewport = useRef<HTMLDivElement>(null);
  const pan = usePanZoom(viewport);
  const { reset: resetPan, jumpTo } = pan;

  // A new franchise is a new graph; a layout effect, so the rail has its content before the canvas is measured.
  useLayoutEffect(() => {
    setSelected(data?.rootId ?? null);
  }, [data?.rootId]);

  const layout = useMemo(
    () => (data ? layoutFranchise(data.nodes, data.edges, data.rootId) : null),
    [data],
  );

  /** The title the user came from, in the middle of the canvas at the resting zoom, on either platform. */
  const recenter = useCallback(() => {
    const box = viewport.current?.getBoundingClientRect();
    const spot = data ? layout?.positions.get(data.rootId) : undefined;
    if (!box || !spot || box.width === 0) return resetPan();
    // The canvas is laid out in rem, so the root's em position scales with the text size the user chose.
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const centre = { x: (spot.x + NODE_W / 2) * rem, y: (spot.y + NODE_H / 2) * rem };
    jumpTo(centerOn(centre, box, 1));
  }, [data, layout, jumpTo, resetPan]);

  // Once per franchise, before paint and after the root is selected: the rail it fills shortens the canvas below `xl`.
  const centred = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!data || !viewport.current || centred.current === data.rootId || selected !== data.rootId) return;
    centred.current = data.rootId;
    recenter();
  }, [data, selected, recenter]);

  const byId = useMemo(
    () => new Map((data?.nodes ?? []).map((n) => [n.id, n])),
    [data],
  );

  /** The status legend's vocabulary: the root's own type, which is what the user navigated from. */
  const legendType = byId.get(data?.rootId ?? -1)?.type ?? "ANIME";

  const links = useMemo(
    () =>
      !data || !layout
        ? []
        : data.edges.filter(
            (e) => layout.positions.has(e.from) && layout.positions.has(e.to),
          ),
    [data, layout],
  );

  // Hover wins over selection.
  const focus = hovered ?? selected;
  const connected = useMemo(() => {
    const set = new Set<number>();
    if (focus === null) return set;
    set.add(focus);
    for (const e of links) {
      if (e.from === focus) set.add(e.to);
      if (e.to === focus) set.add(e.from);
    }
    return set;
  }, [focus, links]);

  const selectedNode = selected !== null ? byId.get(selected) : undefined;

  return (
    // The phone's gutter like every other page: at 360 px the header only fits beside a 1 rem edge.
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      <header className="flex min-w-0 items-center gap-3">
        <BackButton />
        <h1 className="shrink-0 text-lg font-semibold text-ink-100">{t("franchise.title")}</h1>
        {data && (
          <span className="truncate text-2xs uppercase tracking-eyebrow text-ink-600">
            {t("franchise.related", { count: data.nodes.length })}
          </span>
        )}
        <span className="section-rule" />
      </header>

      {isLoading && <Loader label={t("common.loading")} />}
      {error && (
        <p className="text-danger">{t("common.error", { message: String(error) })}</p>
      )}

      {data && layout && data.nodes.length <= 1 && (
        <EmptyState visual={<PerchRule />} title={t("franchise.none")} />
      )}

      {data && layout && data.nodes.length > 1 && (
        // Column below `xl`, row above: the rail holds the page's only open and edit buttons, so it cannot hide.
        <div className="flex min-h-0 flex-1 flex-col gap-4 xl:flex-row">
          <div
            ref={viewport}
            {...pan.handlers}
            className={cn(
              // `touch-none`, or Chromium reclaims a touch drag with a pointercancel mid-gesture and the pan stutters dead.
              "relative min-h-0 min-w-0 flex-1 select-none touch-none overflow-hidden rounded-panel border border-hair bg-surface-900",
              pan.dragging ? "cursor-grabbing" : "cursor-grab",
            )}
            style={{
              // The dot grid rides the pan offset, so the canvas reads as one surface being moved.
              backgroundImage:
                "radial-gradient(circle at 1px 1px, var(--catch-light) 1px, transparent 0)",
              backgroundSize: "1.5rem 1.5rem",
              backgroundPosition: `${pan.tx}px ${pan.ty}px`,
            }}
          >
            <div
              className="absolute left-0 top-0 origin-top-left"
              style={{
                width: `${layout.width}rem`,
                height: `${layout.height}rem`,
                transform: `translate3d(${pan.tx}px, ${pan.ty}px, 0) scale(${pan.zoom})`,
                fontSize: "1rem",
              }}
            >
              <svg
                className="pointer-events-none absolute inset-0 overflow-visible"
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                width={`${layout.width}em`}
                height={`${layout.height}em`}
              >
                {links.map((e, i) => {
                  const a = layout.positions.get(e.from)!;
                  const b = layout.positions.get(e.to)!;
                  // Draw left-to-right whichever way the edge was recorded, so the curve leaves one node's right edge.
                  const [l, r] = a.x <= b.x ? [a, b] : [b, a];
                  const x1 = l.x + NODE_W;
                  const y1 = l.y + COVER_H / 2;
                  const x2 = r.x;
                  const y2 = r.y + COVER_H / 2;
                  const mid = (x1 + x2) / 2;
                  const lit =
                    focus !== null && (e.from === focus || e.to === focus);
                  return (
                    <path
                      key={i}
                      d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
                      fill="none"
                      // Non-scaling so the hairline stays a hairline when zoomed in instead of thickening into a cable.
                      vectorEffect="non-scaling-stroke"
                      style={{
                        stroke: lit
                          ? "rgba(var(--accent-rgb), .85)"
                          : "var(--color-surface-700)",
                        strokeWidth: lit ? 1.75 : 1,
                        transition:
                          "stroke var(--default-transition-duration) var(--ease-karasu), " +
                          "stroke-width var(--default-transition-duration) var(--ease-karasu)",
                      }}
                    />
                  );
                })}
              </svg>

              {[...layout.positions.keys()].map((nodeId) => {
                const node = byId.get(nodeId);
                const spot = layout.positions.get(nodeId);
                const branch = layout.tree.get(nodeId);
                if (!node || !spot || !branch) return null;
                return (
                  <GraphNode
                    key={nodeId}
                    node={node}
                    branch={branch}
                    x={spot.x}
                    y={spot.y}
                    isRoot={nodeId === data.rootId}
                    isSelected={nodeId === selected}
                    dimmed={focus !== null && !connected.has(nodeId)}
                    onHover={setHovered}
                    onSelect={() => {
                      if (pan.dragged()) return;
                      setSelected(nodeId);
                    }}
                    onOpen={() => {
                      if (pan.dragged()) return;
                      navigate(`/media/${nodeId}`);
                    }}
                      />
                );
              })}
            </div>

            <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-control border border-hair bg-surface-850/90 p-1">
              <IconButton
                size="xs"
                aria-label={t("franchise.zoomOut")}
                onClick={() => pan.zoomBy(1 / BUTTON_STEP)}
              >
                <Minus className="size-3.5" />
              </IconButton>
              <button
                type="button"
                onClick={recenter}
                title={t("franchise.resetView")}
                className="min-w-11 rounded-inner px-1 py-0.5 text-2xs tabular-nums text-ink-500 transition-surface hover:bg-surface-800 hover:text-ink-100"
              >
                {Math.round(pan.zoom * 100)}%
              </button>
              <IconButton
                size="xs"
                aria-label={t("franchise.zoomIn")}
                onClick={() => pan.zoomBy(BUTTON_STEP)}
              >
                <Plus className="size-3.5" />
              </IconButton>
            </div>

            {data.truncated && (
              <p className="absolute left-3 top-3 rounded-inner border border-hair bg-surface-850/90 px-2 py-1 text-2xs text-ink-600">
                {t("franchise.truncated")}
              </p>
            )}

            <Legend type={legendType} />
          </div>

          <Rail
            node={selectedNode}
            relation={
              selected !== null ? layout.tree.get(selected)?.relation ?? null : null
            }
            connects={
              selected === null
                ? 0
                : links.filter((e) => e.from === selected || e.to === selected).length
            }
            userId={userId}
            onOpen={() => selectedNode && navigate(`/media/${selectedNode.id}`)}
            onEdit={() => selectedNode && setEditing(selectedNode.id)}
          />
        </div>
      )}

      {/* Through Presence like every other EntryEditModal call site, so the editor has an exit animation. */}
      <Presence value={editing}>
        {(mediaId, leaving) => (
          <EntryEditor
            mediaId={mediaId}
            leaving={leaving}
            type={byId.get(mediaId)?.type ?? "ANIME"}
            userId={userId}
            onClose={() => setEditing(null)}
          />
        )}
      </Presence>
    </div>
  );
}

/** One node: cover, status outline, progress, title and relation. */
function GraphNode({
  node,
  branch,
  x,
  y,
  isRoot,
  isSelected,
  dimmed,
  onHover,
  onSelect,
  onOpen,
}: {
  node: FranchiseNode;
  branch: FranchiseTreeNode;
  x: number;
  y: number;
  isRoot: boolean;
  isSelected: boolean;
  dimmed: boolean;
  onHover: (id: number | null) => void;
  onSelect: () => void;
  /** Double-click: straight to the detail page, like a related cover. */
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const color = colorOf(node.listStatus);
  const title = displayTitle(node.title);
  const done =
    node.progress !== null && node.total ? node.progress / node.total : null;

  return (
    <div
      className="absolute flex flex-col items-center transition-[opacity,transform]"
      style={{
        left: `${x}em`,
        top: `${y}em`,
        width: `${NODE_W}em`,
        height: `${NODE_H}em`,
        opacity: dimmed ? 0.42 : 1,
        zIndex: isSelected ? 2 : 1,
      }}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
    >
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={onOpen}
        className="block w-full text-left"
        style={{ cursor: "pointer" }}
      >
        <div
          className="relative w-full overflow-hidden rounded-[.375em] bg-surface-800"
          style={{
            height: `${COVER_H}em`,
            border: outline(node.listStatus),
            boxShadow: isSelected
              ? "0 .5em 1.25em rgba(0,0,0,.5)"
              : "0 .125em .375em rgba(0,0,0,.3)",
            // An outline with an offset: it follows the radius, cannot be clipped, and floats clear of the status border.
            ...(isSelected && {
              outline: "2px solid rgba(var(--accent-rgb), .9)",
              outlineOffset: "2px",
            }),
          }}
        >
          {node.coverImage.large ? (
            <img
              src={node.coverImage.large}
              alt=""
              draggable={false}
              className="size-full object-cover"
            />
          ) : (
            <span className="grid size-full place-items-center text-[.5625em] uppercase tracking-eyebrow text-ink-600">
              {t("franchise.noCover")}
            </span>
          )}
          {done !== null && (
            <span
              className="absolute inset-x-0 bottom-0 block bg-scrim"
              style={{ height: ".1875em" }}
            >
              <span
                className="block h-full"
                style={{
                  width: `${Math.min(100, done * 100)}%`,
                  background: color,
                }}
              />
            </span>
          )}
        </div>
        <p
          className="mt-[.375em] line-clamp-2 text-center text-[.6875em] leading-tight"
          style={{
            color: isSelected || isRoot ? "var(--color-ink-100)" : "var(--color-ink-300)",
            fontWeight: isRoot ? 700 : 500,
          }}
        >
          {title}
        </p>
        {branch.relation && (
          <p className="text-center text-[.5625em] uppercase tracking-eyebrow text-ink-600">
            {t(`relation.${branch.relation}`, { defaultValue: branch.relation })}
          </p>
        )}
      </button>

    </div>
  );
}

/** The detail rail — what the selected node is, and the two things to do with it. */
function Rail({
  node,
  relation,
  connects,
  userId,
  onOpen,
  onEdit,
}: {
  node: FranchiseNode | undefined;
  relation: string | null;
  connects: number;
  userId: number | undefined;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const entry = useCachedEntry(userId, node?.type, node?.id);

  if (!node) {
    return (
      <aside className={cn(cardClass("raised"), "w-full shrink-0 p-4 xl:w-60")}>
        <p className="text-xs text-ink-600">{t("franchise.selectHint")}</p>
      </aside>
    );
  }

  const latin = displayTitle(node.title);
  const native = node.title.native !== latin ? node.title.native : null;

  return (
    // Keyed on the node so the pane re-runs `settle` when the selection moves; below `xl` it sits under the canvas.
    <aside
      key={node.id}
      className={cn(cardClass("raised"), "flex max-h-64 w-full shrink-0 animate-settle flex-col xl:max-h-none xl:w-60")}
    >
      {/* The scroll lives inside the card, so the card's top catch-light stays put while the contents move. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {node.coverImage.large && (
          <img
            src={node.coverImage.large}
            alt=""
            className="mb-3 hidden aspect-2/3 w-full rounded-control object-cover xl:block"
          />
        )}
        {relation && (
          <p className="text-2xs uppercase tracking-eyebrow text-accent-400">
            {t(`relation.${relation}`, { defaultValue: relation })}
          </p>
        )}
        <p className="mt-0.5 text-sm font-semibold leading-snug text-ink-100">{latin}</p>
        {native && <p className="font-brand-jp text-xs text-ink-600">{native}</p>}

        <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-300">
          <span
            className="size-2 rounded-full"
            style={{ background: colorOf(node.listStatus) }}
          />
          {node.listStatus
            ? t(`status.${node.type}.${node.listStatus}`)
            : t("franchise.notOnList")}
        </p>

        <dl className="mt-3 space-y-1.5 text-2xs">
          <Row label={t("detail.format")}>
            {[
              node.type === "MANGA" ? t("common.manga") : t("common.anime"),
              formatLabel(node.format, t),
            ]
              .filter(Boolean)
              .join(" · ")}
          </Row>
          <Row label={t("franchise.yourProgress")}>
            {node.progress === null
              ? "—"
              : `${node.progress} / ${node.total ?? "?"}`}
          </Row>
          <Row label={t("franchise.connects")}>{connects}</Row>
        </dl>

        <div className="mt-4 space-y-2">
          <Button size="control" className="w-full" onClick={onOpen}>
            {t("franchise.openDetail")}
          </Button>
          {entry ? (
            <Button variant="outline" size="control" className="w-full" onClick={onEdit}>
              {t("franchise.editEntry")}
            </Button>
          ) : (
            <Button variant="outline" size="control" className="w-full" onClick={onOpen}>
              {t("franchise.addToList")}
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ink-600">{label}</dt>
      <dd className="truncate text-ink-300">{children}</dd>
    </div>
  );
}

/** The entry editor from the rail, run off the cached list entry so opening it spends no request. */
function EntryEditor({
  mediaId,
  leaving,
  type,
  userId,
  onClose,
}: {
  mediaId: number;
  leaving: boolean;
  type: "ANIME" | "MANGA";
  userId: number | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const entry = useCachedEntry(userId, type, mediaId);
  const { save, remove } = useListMutations(userId ?? 0, type);

  // No cached entry means nothing to edit, so say so rather than closing mutely like a broken button.
  useEffect(() => {
    if (!entry) {
      showToast({ kind: "error", text: t("franchise.editMissing") });
      onClose();
    }
  }, [entry, onClose, t]);
  if (!entry) return null;

  return (
    <EntryEditModal
      leaving={leaving}
      media={{ ...entry.media, type }}
      entry={entry}
      onClose={onClose}
      onSave={(input) => {
        save.mutate(input);
        onClose();
      }}
      onDelete={() => {
        remove.mutate(entry.id);
        onClose();
      }}
    />
  );
}

/** The colour key, folded into a chip in the graph's corner until asked for; the choice is remembered per machine. */
function Legend({ type }: { type: MediaType }) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(loadLegendOpen);
  const toggle = () => {
    saveLegendOpen(!open);
    setOpen(!open);
  };
  return (
    // A control on the canvas, not a handle for it: a press here must not start a pan.
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-2"
    >
      {/* Above the chip rather than beside it, so the open key never runs under the zoom controls on a phone. */}
      {open && (
        <ul
          id={id}
          className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-control border border-hair bg-surface-850/90 px-2.5 py-2 text-2xs text-ink-500 backdrop-blur-sm"
        >
          {LEGEND.map((status) => (
            <li key={status ?? "none"} className={cn("flex items-center gap-1.5", !status && "col-span-2")}>
              <span className="size-2.5 shrink-0 rounded-inner" style={{ border: outline(status) }} />
              {/* Resolved on the root's type, or a pinned ANIME legend reads "Watching" over nodes that say "Reading". */}
              {status ? t(`status.${type}.${status}`) : t("franchise.notOnList")}
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className="inline-flex h-9.5 items-center gap-1.5 rounded-control border border-hair bg-surface-850/90 px-2.5 text-2xs font-semibold uppercase tracking-eyebrow text-ink-300 backdrop-blur-sm transition-surface hover:text-ink-100"
      >
        {!open &&
          (["CURRENT", "COMPLETED", "PLANNING"] as const).map((s) => (
            <span key={s} aria-hidden className="size-2.5 rounded-inner" style={{ border: outline(s) }} />
          ))}
        {t("franchise.legend")}
        {open ? <ChevronDown aria-hidden className="size-3.5" /> : <ChevronUp aria-hidden className="size-3.5" />}
      </button>
    </div>
  );
}
