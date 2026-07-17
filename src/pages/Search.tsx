import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon } from "lucide-react";
import { searchAnime } from "@/api/queries";
import { Input } from "@/components/ui/input";
import MediaCard from "@/components/MediaCard";
import { isTauri } from "@/api/anilist";

export default function Search() {
  const [input, setInput] = useState("");
  const [term, setTerm] = useState("");

  // Debounce: erst nach 500 ms Tipppause suchen (Rate-Limit schonen)
  useEffect(() => {
    const t = setTimeout(() => setTerm(input.trim()), 500);
    return () => clearTimeout(t);
  }, [input]);

  const { data, isFetching, error } = useQuery({
    queryKey: ["search", term],
    queryFn: () => searchAnime(term),
    enabled: isTauri && term.length >= 2,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="px-8 pt-6">
        <h1 className="text-2xl font-bold">Suche</h1>
        <div className="relative mt-4 max-w-md">
          <SearchIcon
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-600"
          />
          <Input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Anime auf AniList suchen …"
            className="h-10 pl-9"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {error && (
          <p className="text-sm text-red-300">Fehler: {String(error)}</p>
        )}
        {isFetching && <p className="text-sm text-ink-600">Suche …</p>}
        {!isFetching && term.length >= 2 && data?.media.length === 0 && (
          <p className="text-sm text-ink-600">Keine Treffer für „{term}".</p>
        )}
        {data && data.media.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-6">
            {data.media.map((m) => (
              <MediaCard key={m.id} media={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
