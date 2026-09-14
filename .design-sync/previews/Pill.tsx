import { Pill } from "karasu";

const row = { display: "flex", flexWrap: "wrap" as const, gap: 8, padding: 16 };

export const StatusRow = () => (
  <div style={row}>
    <Pill active>Watching</Pill>
    <Pill>Planning</Pill>
    <Pill>Completed</Pill>
    <Pill>Paused</Pill>
    <Pill>Dropped</Pill>
  </div>
);

export const Formats = () => (
  <div style={row}>
    <Pill>TV</Pill>
    <Pill active>Movie</Pill>
    <Pill>OVA</Pill>
    <Pill disabled>Music</Pill>
  </div>
);
