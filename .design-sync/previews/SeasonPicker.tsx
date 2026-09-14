import { SeasonPicker } from "karasu";

export const Closed = () => (
  <div style={{ display: "flex", gap: 24, padding: 16 }}>
    <SeasonPicker season="FALL" year={2026} onPick={() => {}} />
    <SeasonPicker season="WINTER" year={2027} onPick={() => {}} />
  </div>
);
