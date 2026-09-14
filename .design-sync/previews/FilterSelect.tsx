import { FilterSelect } from "karasu";

const row = { display: "flex", gap: 8, padding: 16, flexWrap: "wrap" as const };

export const Toolbar = () => (
  <div style={row}>
    <FilterSelect
      label="Sort"
      value="score"
      onChange={() => {}}
      options={[{ value: "title", label: "Title" }, { value: "score", label: "Score" }, { value: "updated", label: "Last updated" }]}
    />
    <FilterSelect
      label="Format"
      value=""
      placeholder="Any"
      onChange={() => {}}
      options={[{ value: "TV", label: "TV" }, { value: "MOVIE", label: "Movie" }, { value: "OVA", label: "OVA" }]}
    />
    <FilterSelect
      label="Year"
      value="2026"
      onChange={() => {}}
      options={[{ value: "2026", label: "2026" }, { value: "2025", label: "2025" }]}
    />
  </div>
);
