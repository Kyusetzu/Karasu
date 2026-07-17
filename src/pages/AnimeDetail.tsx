import { useParams } from "react-router-dom";

export default function AnimeDetail() {
  const { id } = useParams();
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Anime #{id}</h1>
      <p className="mt-2 text-sm text-ink-500">Detailseite folgt.</p>
    </div>
  );
}
