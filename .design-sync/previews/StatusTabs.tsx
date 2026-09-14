import { StatusTabs } from "karasu";

const tabs = [
  { value: "CURRENT", label: "Watching", count: 12 },
  { value: "PLANNING", label: "Planning", count: 148 },
  { value: "COMPLETED", label: "Completed", count: 301 },
  { value: "PAUSED", label: "Paused", count: 9 },
  { value: "DROPPED", label: "Dropped", count: 23 },
  { value: "REPEATING", label: "Rewatching", count: 2 },
];

export const ListTabs = () => (
  <div style={{ padding: "16px 16px 0" }}>
    <StatusTabs tabs={tabs} value="CURRENT" onChange={() => {}} className="pb-3.5" />
  </div>
);

export const Wrapped = () => (
  <div style={{ padding: "16px 16px 0", maxWidth: 360 }}>
    <StatusTabs tabs={tabs} value="PAUSED" onChange={() => {}} className="pb-3.5" />
  </div>
);
