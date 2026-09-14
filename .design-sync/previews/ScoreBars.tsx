import { ScoreBars } from "karasu";

export const TenPoint = () => (
  <div style={{ display: "grid", gap: 20, padding: 16 }}>
    <ScoreBars value={8} onChange={() => {}} />
    <ScoreBars value={0} onChange={() => {}} />
  </div>
);
