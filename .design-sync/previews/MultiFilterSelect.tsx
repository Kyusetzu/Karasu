import { MultiFilterSelect } from "karasu";

const genres = ["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mystery", "Romance", "Sci-Fi", "Slice of Life"];

export const Closed = () => (
  <div style={{ display: "flex", gap: 8, padding: 16 }}>
    <MultiFilterSelect label="Genres" value={{ include: [], exclude: [] }} onChange={() => {}} options={genres} placeholder="Any" />
    <MultiFilterSelect
      label="Genres"
      value={{ include: ["Fantasy", "Drama"], exclude: ["Horror"] }}
      onChange={() => {}}
      options={genres}
      placeholder="Any"
      searchable
    />
  </div>
);
