import { Loader } from "karasu";

export const Sizes = () => (
  <div style={{ display: "grid", gap: 24, padding: 16 }}>
    <Loader label="Loading your list" />
    <Loader size="sm" label="Checking AniList" />
  </div>
);
