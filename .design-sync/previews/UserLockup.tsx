import { UserLockup } from "karasu";

export const Rows = () => (
  <div style={{ display: "grid", gap: 14, padding: 16, maxWidth: 360 }}>
    <UserLockup name="Kyusetzu" sub={<span className="block text-xs text-ink-600">finished Frieren · 2 h ago</span>} />
    <UserLockup name="Modchi" sub={<span className="block text-xs text-accent-400">Follows you</span>} />
    <UserLockup name="A very long username that truncates" sub={<span className="block text-xs text-ink-600">Mutual</span>} titleAttr />
  </div>
);

export const Sizes = () => (
  <div style={{ display: "grid", gap: 16, padding: 16, maxWidth: 360 }}>
    <UserLockup name="Kyusetzu" size="sm" sub={<span className="block text-2xs text-ink-600">Synced 1 min ago</span>} />
    <UserLockup name="Kyusetzu" size="lg" sub={<span className="block text-sm text-ink-600">524 anime · 125 manga</span>} />
  </div>
);
