import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Minus, Plus } from "lucide-react";
import { loadFranchise, type FranchiseNode } from "@/api/franchise";
import { useContentFilter } from "@/stores/contentFilter";
import { useAuth } from "@/stores/auth";
import { isTauri } from "@/api/anilist";
import { formatLabel } from "@/lib/format";
import {
  COVER_H,
  layoutFranchise,
  NODE_H,
  NODE_W,
  type FranchiseTreeNode,
} from "@/lib/franchiseLayout";
import { usePanZoom } from "@/hooks/usePanZoom";
import { useCachedEntry } from "@/hooks/useCachedEntry";
import { useListMutations } from "@/hooks/useListMutations";
import { displayTitle, type MediaListStatus } from "@/api/types";
import BackButton from "@/components/shell/BackButton";
import EntryEditModal from "@/components/media/EntryEditModal";
import { EmptyState, PerchRule } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

/**
 * List status → node outline. Watching rides the accent because it is the one
 * state the user is actually in; everything else is a fixed hue, so a graph
 * doesn't repaint half its outlines when the accent changes.
 */
const STATUS_COLOR: Record<MediaListStatus, string> = {
  CURRENT: "var(--color-accent-400)",
  REPEATING: "var(--color-accent-400)",
  COMPLETED: "var(--color-graph-completed)",
  PAUSED: "var(--color-gold)",
  DROPPED: "var(--color-danger)",
  PLANNING: "var(--color-surface-600)",
};
const NO_STATUS = "var(--color-graph-none)";

const colorOf = (status: MediaListStatus | null) =>
  status ? STATUS_COLOR[status] : NO_STATUS;

/**
 * Planning and not-on-list are the two muted greys in the palette, and they
 * measure three RGB points apart — as outlines they are one colour. The line
 * style carries the distinction the colours can't: a title you have not
 * tracked is drawn dashed.
 */
const outline = (status: MediaListStatus | null) =>
  `2px ${status ? "solid" : "dashed"} ${colorOf(status)}`;

/** The four the legend names — the other two share their colour. */
const LEGEND: (MediaListStatus | null)[] = [
  "CURRENT",
  "COMPLETED",
  "PLANNING",
  null,
];

export default function Franchise() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const rootId = Number(id);

  const level = useContentFilter((s) => s.level);
  const filterReady = useContentFilter((s) => s.ready);
  const userId = useAuth((s) => s.viewer?.id);

  const { data, isLoading, error } = useQuery({
    queryKey: ["franchise", rootId, level],
    queryFn: () => loadFranchise(rootId, level),
    enabled: isTauri && filterReady && Number.isFinite(rootId),
    // A franchise graph is a bounded BFS over several batched requests — by
    // far the most expensive thing Karasu fetches — and relations barely
    // change. `gcTime` matters as much as `staleTime` here: the page is
    // unmounted the moment you navigate away, and the default 30-minute
    // collection would throw the graph out before a stale one ever mattered.
    //
    // Not a full day, though: `listStatus` drives every node's outline colour,
    // so the graph would keep showing yesterday's progress.
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });

  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set());
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);

  const viewport = useRef<HTMLDivElement>(null);
  const pan = usePanZoom(viewport);

  // A new franchise is a new graph: nothing about the last one's collapse set
  // or selection means anything here.
  useEffect(() => {
    setCollapsed(new Set());
    setSelected(data?.rootId ?? null);
    pan.reset();
  }, [data?.rootId, pan.reset]);

  const layout = useMemo(
    () => (data ? layoutFranchise(data.nodes, data.edges, data.rootId, collapsed) : null),
    [data, collapsed],
  );

  const byId = useMemo(
    () => new Map((data?.nodes ?? []).map((n) => [n.id, n])),
    [data],
  );

  const links = useMemo(
    () =>
      !data || !layout
        ? []
        : data.edges.filter(
            (e) => layout.visible.has(e.from) && layout.visible.has(e.to),
          ),
    [data, layout],
  );

  // Hover wins over selection so pointing at a node previews its branch
  // without losing what the rail is showing. A hovered node that a collapse
  // removes never gets its `mouseleave`, so the hover is dropped the moment it
  // stops being on screen — otherwise the graph dims around a ghost.
  const focus =
    hovered !== null && layout?.visible.has(hovered) ? hovered : selected;
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

  const toggle = (nodeId: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(nodeId)) next.add(nodeId);
      return next;
    });
    // Selecting something and then folding it away leaves the rail describing
    // a node that is no longer on screen; the fold itself is the new subject.
    setSelected((cur) => {
      if (cur === null || !layout) return cur;
      let walk = layout.tree.get(cur)?.parent ?? null;
      while (walk !== null) {
        if (walk === nodeId) return nodeId;
        walk = layout.tree.get(walk)?.parent ?? null;
      }
      return cur;
    });
  };

  const selectedNode = selected !== null ? byId.get(selected) : undefined;

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header className="flex items-center gap-3">
        <BackButton />
        <h1 className="text-lg font-semibold text-ink-100">{t("franchise.title")}</h1>
        {data && (
          <span className="text-2xs uppercase tracking-[.09em] text-ink-600">
            {t("franchise.related", { count: data.nodes.length })}
          </span>
        )}
        <span className="section-rule" />
        <div className="flex shrink-0 items-center gap-3 text-2xs text-ink-500">
          {LEGEND.map((status) => (
            <span key={status ?? "none"} className="flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-[.1875rem]"
                style={{ border: outline(status) }}
              />
              {status ? t(`status.ANIME.${status}`) : t("franchise.notOnList")}
            </span>
          ))}
        </div>
      </header>

      {isLoading && <p className="text-ink-500">{t("common.loading")}</p>}
      {error && (
        <p className="text-danger">{t("common.error", { message: String(error) })}</p>
      )}

      {data && layout && data.nodes.length <= 1 && (
        <EmptyState visual={<PerchRule />} title={t("franchise.none")} />
      )}

      {data && layout && data.nodes.length > 1 && (
        <div className="flex min-h-0 flex-1 gap-4">
          <div
            ref={viewport}
            {...pan.handlers}
            className={cn(
              "relative min-w-0 flex-1 select-none overflow-hidden rounded-xl border border-hair bg-surface-900",
              pan.dragging ? "cursor-grabbing" : "cursor-grab",
            )}
            style={{
              // The dot grid rides the pan offset, so the canvas reads as one
              // surface being moved rather than nodes sliding over a backdrop.
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
                  // Draw left-to-right whichever way the edge was recorded, so
                  // the curve always leaves one node's right edge.
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
                      // Non-scaling so the hairline stays a hairline at 1.6×,
                      // where a scaled 1px would render as a cable.
                      vectorEffect="non-scaling-stroke"
                      style={{
                        stroke: lit
                          ? "rgba(var(--accent-rgb), .85)"
                          : "var(--color-surface-700)",
                        strokeWidth: lit ? 1.75 : 1,
                        transition: "stroke 140ms var(--ease-karasu, ease), stroke-width 140ms",
                      }}
                    />
                  );
                })}
              </svg>

              {[...layout.visible].map((nodeId) => {
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
                    collapsed={collapsed.has(nodeId)}
                    onHover={setHovered}
                    onSelect={() => {
                      if (pan.dragged()) return;
                      setSelected(nodeId);
                    }}
                    onToggle={() => toggle(nodeId)}
                  />
                );
              })}
            </div>

            <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg border border-hair bg-surface-850/90 p-1">
              <IconButton
                size="xs"
                aria-label={t("franchise.zoomOut")}
                onClick={() => pan.zoomBy(1 / 1.15)}
              >
                <Minus className="size-3.5" />
              </IconButton>
              <button
                type="button"
                onClick={pan.reset}
                title={t("franchise.resetView")}
                className="min-w-11 rounded-md px-1 py-0.5 text-2xs tabular-nums text-ink-500 transition-surface hover:bg-surface-800 hover:text-ink-100"
              >
                {Math.round(pan.zoom * 100)}%
              </button>
              <IconButton
                size="xs"
                aria-label={t("franchise.zoomIn")}
                onClick={() => pan.zoomBy(1.15)}
              >
                <Plus className="size-3.5" />
              </IconButton>
            </div>

            {data.truncated && (
              <p className="absolute left-3 top-3 rounded-md border border-hair bg-surface-850/90 px-2 py-1 text-2xs text-ink-600">
                {t("franchise.truncated")}
              </p>
            )}
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

      {editing !== null && (
        <EntryEditor
          mediaId={editing}
          type={byId.get(editing)?.type ?? "ANIME"}
          userId={userId}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** One node: cover, status outline, progress, title, relation, collapse pill. */
function GraphNode({
  node,
  branch,
  x,
  y,
  isRoot,
  isSelected,
  dimmed,
  collapsed,
  onHover,
  onSelect,
  onToggle,
}: {
  node: FranchiseNode;
  branch: FranchiseTreeNode;
  x: number;
  y: number;
  isRoot: boolean;
  isSelected: boolean;
  dimmed: boolean;
  collapsed: boolean;
  onHover: (id: number | null) => void;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const color = colorOf(node.listStatus);
  const title = displayTitle(node.title);
  const done =
    node.progress !== null && node.total ? node.progress / node.total : null;

  return (
    <div
      className="absolute flex flex-col items-center transition-[opacity,transform] duration-140"
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
            <span className="grid size-full place-items-center text-[.5625em] uppercase tracking-[.12em] text-ink-600">
              {t("franchise.noCover")}
            </span>
          )}
          {done !== null && (
            <span
              className="absolute inset-x-0 bottom-0 block bg-[rgba(4,5,8,.55)]"
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
          <p className="text-center text-[.5625em] uppercase tracking-[.1em] text-ink-600">
            {t(`relation.${branch.relation}`, { defaultValue: branch.relation })}
          </p>
        )}
      </button>

      {branch.children.length > 0 && (
        <button
          type="button"
          onClick={onToggle}
          aria-label={t(collapsed ? "franchise.expand" : "franchise.collapse")}
          className="absolute left-1/2 grid -translate-x-1/2 place-items-center rounded-full border border-surface-700 bg-surface-850 text-[.5625em] tabular-nums text-ink-300 transition-surface hover:border-accent-500 hover:text-ink-100"
          style={{ bottom: "-.625em", height: "1.25em", minWidth: "1.25em", padding: "0 .375em" }}
        >
          {collapsed ? `+${branch.descendants}` : "−"}
        </button>
      )}
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
      <aside className="hidden w-60 shrink-0 rounded-xl border border-hair bg-surface-900 p-4 xl:block">
        <p className="text-xs text-ink-600">{t("franchise.selectHint")}</p>
      </aside>
    );
  }

  const latin = displayTitle(node.title);
  const native = node.title.native !== latin ? node.title.native : null;

  return (
    // Keyed on the node so the pane re-runs `settle` when the selection moves,
    // which is the only cue that the rail changed at all.
    <aside
      key={node.id}
      className="hidden w-60 shrink-0 animate-settle overflow-y-auto rounded-xl border border-hair bg-surface-900 p-4 panel-wash xl:block"
    >
      {node.coverImage.large && (
        <img
          src={node.coverImage.large}
          alt=""
          className="mb-3 aspect-2/3 w-full rounded-lg object-cover"
        />
      )}
      {relation && (
        <p className="text-2xs uppercase tracking-[.1em] text-accent-400">
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

/**
 * The entry editor, opened from the rail.
 *
 * It runs off the cached list entry rather than a fetch: the franchise query
 * carries status and progress but not score, repeat or notes, and pulling a
 * whole media just to open a dialog would spend a request from a ~30/min
 * budget on something the list screens already hold.
 */
function EntryEditor({
  mediaId,
  type,
  userId,
  onClose,
}: {
  mediaId: number;
  type: "ANIME" | "MANGA";
  userId: number | undefined;
  onClose: () => void;
}) {
  const entry = useCachedEntry(userId, type, mediaId);
  const { save, remove } = useListMutations(userId ?? 0, type);

  useEffect(() => {
    if (!entry) onClose();
  }, [entry, onClose]);
  if (!entry) return null;

  return (
    <EntryEditModal
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
