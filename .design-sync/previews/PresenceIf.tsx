import { PresenceIf } from "karasu";

export const Open = () => (
  <div style={{ padding: 16 }}>
    <PresenceIf when>
      {(leaving) => (
        <div className="panel-wash rounded-xl border border-surface-800 bg-surface-900 p-4 text-sm text-ink-100">
          An overlay that stays mounted through its exit {leaving ? "(leaving)" : ""}
        </div>
      )}
    </PresenceIf>
  </div>
);
