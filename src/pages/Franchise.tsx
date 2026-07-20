import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { loadFranchise } from "@/api/franchise";
import { isTauri } from "@/api/anilist";
import { formatLabel } from "@/lib/format";
import { layoutFranchise, NODE_H, NODE_W } from "@/lib/franchiseLayout";
import { displayTitle, type MediaListStatus } from "@/api/types";
import { Button } from "@/components/ui/button";

/** List-status → accent colour for a node's outline + dot. */
const STATUS_COLOR: Record<MediaListStatus, string> = {
  CURRENT: "#34d399",
  REPEATING: "#2dd4bf",
  COMPLETED: "#60a5fa",
  PAUSED: "#fbbf24",
  DROPPED: "#f87171",
  PLANNING: "#a78bfa",
};
const NO_STATUS = "#64748b";

const colorOf = (status: MediaListStatus | null) =>
  status ? STATUS_COLOR[status] : NO_STATUS;

export default function Franchise() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const rootId = Number(id);

  const { data, isLoading, error } = useQuery({
    queryKey: ["franchise", rootId],
    queryFn: () => loadFranchise(rootId),
    enabled: isTauri && Number.isFinite(rootId),
  });

  const layout = useMemo(() => {
    if (!data) return null;
    const { positions, width, height } = layoutFranchise(
      data.nodes,
      data.edges,
      data.rootId,
    );
    return { pos: positions, width, height };
  }, [data]);

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="mb-4 flex items-center gap-3">
        <Button
          variant="secondary"
          size="icon"
          aria-label={t("detail.back")}
          onClick={() => navigate(-1)}
        >
          <ArrowLeft size={16} />
        </Button>
        <h1 className="text-xl font-bold">{t("franchise.title")}</h1>
      </div>

      {isLoading && <p className="text-ink-500">{t("common.loading")}</p>}
      {error && (
        <p className="text-red-300">
          {t("common.error", { message: String(error) })}
        </p>
      )}

      {data && layout && (
        <>
          {data.nodes.length <= 1 ? (
            <p className="text-sm text-ink-600">{t("franchise.none")}</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-surface-800 bg-surface-900 p-2">
              <svg
                width={layout.width}
                height={layout.height}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                className="max-w-none"
              >
                {data.edges.map((e, i) => {
                  const a = layout.pos.get(e.from);
                  const b = layout.pos.get(e.to);
                  if (!a || !b) return null;
                  const ax = a.x + NODE_W / 2;
                  const ay = a.y + NODE_H / 2;
                  const bx = b.x + NODE_W / 2;
                  const by = b.y + NODE_H / 2;
                  return (
                    <g key={i}>
                      <line
                        x1={ax}
                        y1={ay}
                        x2={bx}
                        y2={by}
                        style={{ stroke: "var(--color-surface-700)" }}
                        strokeWidth={1.5}
                      />
                      <text
                        x={(ax + bx) / 2}
                        y={(ay + by) / 2 - 3}
                        textAnchor="middle"
                        className="select-none"
                        style={{
                          fill: "var(--color-ink-600)",
                          fontSize: 9,
                        }}
                      >
                        {t(`relation.${e.relation}`, {
                          defaultValue: e.relation,
                        })}
                      </text>
                    </g>
                  );
                })}

                {data.nodes.map((n) => {
                  const p = layout.pos.get(n.id)!;
                  const color = colorOf(n.listStatus);
                  const isRoot = n.id === data.rootId;
                  const label = displayTitle(n.title);
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${p.x}, ${p.y})`}
                      className="cursor-pointer"
                      onClick={() => navigate(`/media/${n.id}`)}
                    >
                      <rect
                        width={NODE_W}
                        height={NODE_H}
                        rx={10}
                        style={{
                          fill: "var(--color-surface-800)",
                          stroke: color,
                        }}
                        strokeWidth={isRoot ? 3 : 1.5}
                      />
                      <circle cx={14} cy={NODE_H / 2} r={5} style={{ fill: color }} />
                      <text
                        x={28}
                        y={NODE_H / 2 - 4}
                        className="select-none"
                        style={{
                          fill: "var(--color-ink-100)",
                          fontSize: 12,
                          fontWeight: isRoot ? 700 : 500,
                        }}
                      >
                        {label.length > 20 ? `${label.slice(0, 19)}…` : label}
                      </text>
                      <text
                        x={28}
                        y={NODE_H / 2 + 12}
                        className="select-none"
                        style={{ fill: "var(--color-ink-500)", fontSize: 10 }}
                      >
                        {[
                          n.type === "MANGA" ? t("common.manga") : t("common.anime"),
                          formatLabel(n.format, t),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}

          {data.truncated && (
            <p className="mt-2 text-xs text-ink-600">{t("franchise.truncated")}</p>
          )}

          <div className="mt-4 flex flex-wrap gap-3 text-xs text-ink-500">
            {(Object.keys(STATUS_COLOR) as MediaListStatus[]).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: STATUS_COLOR[s] }}
                />
                {t(`status.ANIME.${s}`)}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: NO_STATUS }}
              />
              {t("franchise.notOnList")}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
