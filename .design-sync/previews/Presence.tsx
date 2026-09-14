import { Presence } from "karasu";

export const Shown = () => (
  <div style={{ padding: 16 }}>
    <Presence value={{ title: "Frieren: Beyond Journey's End" }}>
      {(entry, leaving) => (
        <div className="panel-wash rounded-xl border border-surface-800 bg-surface-900 p-4 text-sm text-ink-100">
          {entry.title} {leaving ? "(leaving)" : ""}
        </div>
      )}
    </Presence>
  </div>
);
