import { gql } from "./anilist";
import { isBlocked, type ContentFilterLevel } from "@/lib/contentFilter";
import type { MediaListStatus, MediaTitle, MediaType } from "./types";

/**
 * Loads a media's franchise as a relation graph via a bounded, batched
 * breadth-first walk over AniList's `relations`. Every relation shown under
 * AniList's "Relations" heading is displayed (both media types), and the walk
 * follows the franchise-structural relations — including cross-medium
 * adaptation/source links — to assemble the whole franchise. Loose links
 * (character/other/summary) are shown but not expanded through, and the walk
 * is depth- and node-capped so deep or cyclic graphs can't blow up.
 */

const FRANCHISE_QUERY = `
query ($ids: [Int]) {
  Page(perPage: 50) {
    media(id_in: $ids) {
      id
      type
      title { romaji english native }
      coverImage { large }
      format
      episodes
      chapters
      isAdult
      genres
      mediaListEntry { status progress }
      relations {
        edges {
          relationType
          node {
            id
            type
            title { romaji english native }
            coverImage { large }
            format
            episodes
            chapters
            isAdult
            genres
            mediaListEntry { status progress }
          }
        }
      }
    }
  }
}`;

// Relation types we walk *through* to complete the franchise (cross-medium
// adaptation/source included). Everything else (character/summary/other) is
// still shown as a node, just not expanded from.
const TRAVERSE = new Set([
  "ADAPTATION",
  "SOURCE",
  "PREQUEL",
  "SEQUEL",
  "PARENT",
  "SIDE_STORY",
  "SPIN_OFF",
  "ALTERNATIVE",
  "COMPILATION",
  "CONTAINS",
]);

const MAX_DEPTH = 3;
const MAX_NODES = 60;

export interface FranchiseNode {
  id: number;
  type: MediaType;
  title: MediaTitle;
  coverImage: { large: string | null };
  format: string | null;
  listStatus: MediaListStatus | null;
  /** null when the title isn't on the list — 0 means on the list, unstarted. */
  progress: number | null;
  /** Episodes or chapters, whichever the medium counts in; null if unannounced. */
  total: number | null;
}

export interface FranchiseEdge {
  from: number;
  to: number;
  relation: string;
}

export interface FranchiseGraph {
  rootId: number;
  nodes: FranchiseNode[];
  edges: FranchiseEdge[];
  /** true if a cap stopped the walk before the graph was exhausted */
  truncated: boolean;
}

interface RawMedia {
  id: number;
  type: MediaType;
  title: MediaTitle;
  coverImage: { large: string | null } | null;
  format: string | null;
  episodes: number | null;
  chapters: number | null;
  isAdult: boolean | null;
  genres: string[] | null;
  mediaListEntry: { status: MediaListStatus; progress: number } | null;
}

export async function loadFranchise(
  rootId: number,
  level: ContentFilterLevel = "off",
): Promise<FranchiseGraph> {
  const nodes = new Map<number, FranchiseNode>();
  const edges: FranchiseEdge[] = [];
  const visited = new Set<number>();
  let frontier = [rootId];
  let truncated = false;

  // A filtered node is dropped entirely — no node, no edge, no traversal —
  // so the graph never renders an edge pointing at something invisible.
  const hidden = (m: RawMedia | null | undefined) =>
    isBlocked(m ? { isAdult: m.isAdult, genres: m.genres } : null, level);

  const addNode = (m: RawMedia | null | undefined) => {
    if (!m || (m.type !== "ANIME" && m.type !== "MANGA")) return;
    if (hidden(m)) return;
    if (!nodes.has(m.id)) {
      nodes.set(m.id, {
        id: m.id,
        type: m.type,
        title: m.title,
        coverImage: m.coverImage ?? { large: null },
        format: m.format ?? null,
        listStatus: m.mediaListEntry?.status ?? null,
        progress: m.mediaListEntry?.progress ?? null,
        total: (m.type === "MANGA" ? m.chapters : m.episodes) ?? null,
      });
    }
  };

  const hasEdge = (a: number, b: number) =>
    edges.some(
      (e) =>
        (e.from === a && e.to === b) || (e.from === b && e.to === a),
    );

  for (let depth = 0; depth <= MAX_DEPTH && frontier.length; depth++) {
    const ids = frontier.filter((id) => !visited.has(id)).slice(0, 50);
    if (ids.length === 0) break;
    ids.forEach((id) => visited.add(id));

    const data = await gql<{
      Page: {
        media: (RawMedia & {
          relations: { edges: { relationType: string; node: RawMedia }[] };
        })[];
      };
    }>(FRANCHISE_QUERY, { ids });

    const next: number[] = [];
    for (const media of data.Page.media) {
      if (hidden(media)) continue;
      addNode(media);
      for (const edge of media.relations.edges) {
        const node = edge.node;
        if (!node || (node.type !== "ANIME" && node.type !== "MANGA")) continue;
        if (hidden(node)) continue;
        // Show every relation…
        addNode(node);
        // Keep a single edge per pair (SEQUEL/PREQUEL are reciprocal).
        if (!hasEdge(media.id, node.id)) {
          edges.push({
            from: media.id,
            to: node.id,
            relation: edge.relationType,
          });
        }
        // …but only walk deeper through the franchise-structural ones.
        if (
          depth < MAX_DEPTH &&
          TRAVERSE.has(edge.relationType) &&
          !visited.has(node.id)
        ) {
          next.push(node.id);
        }
      }
    }

    if (nodes.size >= MAX_NODES) {
      truncated = true;
      break;
    }
    frontier = next;
  }

  return { rootId, nodes: [...nodes.values()], edges, truncated };
}
