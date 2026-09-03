import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ListResult } from "@/api/types";
import { useCachedMedia } from "./useCachedMedia";

/** Renders what the hook answers, so the assertion reads like the card would. */
function Probe({ mediaId }: { mediaId: number }) {
  const hit = useCachedMedia(mediaId);
  return <p>{hit ? `${hit.mediaType}/${hit.userId}/${hit.entry.progress}` : "miss"}</p>;
}

/** One cached list with one entry — the reduced shape LIST_QUERY leaves in the cache. */
function cachedList(mediaId: number, progress: number): ListResult {
  return {
    fromCache: true,
    pending: 0,
    lists: [
      {
        name: "Planning",
        status: "PLANNING",
        isCustomList: false,
        entries: [
          {
            id: 1,
            mediaId,
            status: "PLANNING",
            score: 0,
            progress,
            media: { id: mediaId, title: { romaji: "Test Anime 001" } },
          },
        ],
      },
    ],
  } as unknown as ListResult;
}

function renderProbe(qc: QueryClient, mediaId: number) {
  return render(
    <QueryClientProvider client={qc}>
      <Probe mediaId={mediaId} />
    </QueryClientProvider>,
  );
}

describe("useCachedMedia", () => {
  it("finds an entry in whichever list cache holds it, and says which", () => {
    const qc = new QueryClient();
    qc.setQueryData(["mediaList", "ANIME", 153164], cachedList(110200, 0), { updatedAt: 0 });
    renderProbe(qc, 110200);
    expect(screen.getByText("ANIME/153164/0")).toBeTruthy();
  });

  it("misses a title that is on no cached list", () => {
    const qc = new QueryClient();
    qc.setQueryData(["mediaList", "ANIME", 153164], cachedList(110200, 0), { updatedAt: 0 });
    renderProbe(qc, 21);
    expect(screen.getByText("miss")).toBeTruthy();
  });
});
