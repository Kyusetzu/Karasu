import { Avatar } from "karasu";
import { BarChart3 } from "lucide-react";

export const Sizes = () => (
  <div style={{ display: "flex", gap: 16, alignItems: "center", padding: 16 }}>
    <Avatar name="Kyusetzu" size="sm" />
    <Avatar name="Kyusetzu" size="md" />
    <Avatar name="Modchi" size="lg" />
    <Avatar name="Hori" size="xl" />
    <Avatar name="Aria" size="2xl" />
  </div>
);

export const Fallbacks = () => (
  <div style={{ display: "flex", gap: 16, alignItems: "center", padding: 16 }}>
    <Avatar name="Kyusetzu" size="lg" />
    <Avatar size="lg" fallback={<BarChart3 className="size-5" />} />
    <Avatar size="lg" />
  </div>
);
