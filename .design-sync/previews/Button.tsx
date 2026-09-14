import { Button } from "karasu";
import { Play, Plus, RefreshCw, Trash2 } from "lucide-react";

const row = { display: "flex", flexWrap: "wrap" as const, gap: 12, alignItems: "center", padding: 16 };

export const Variants = () => (
  <div style={row}>
    <Button>Add to list</Button>
    <Button variant="secondary">Sync now</Button>
    <Button variant="outline">Edit entry</Button>
    <Button variant="ghost">Cancel</Button>
    <Button variant="danger">Remove from list</Button>
    <Button variant="dangerGhost">Reset</Button>
  </div>
);

export const Sizes = () => (
  <div style={row}>
    <Button>Default</Button>
    <Button size="control">Control</Button>
    <Button size="sm">Small</Button>
    <Button size="icon" aria-label="Play"><Play className="size-4" /></Button>
    <Button size="iconControl" variant="secondary" aria-label="Refresh"><RefreshCw className="size-3.5" /></Button>
  </div>
);

export const WithIcons = () => (
  <div style={row}>
    <Button><Plus className="size-4" /> Add to list</Button>
    <Button variant="secondary" size="sm"><RefreshCw className="size-3.5" /> Sync now</Button>
    <Button variant="danger" size="sm"><Trash2 className="size-3.5" /> Delete</Button>
  </div>
);

export const Disabled = () => (
  <div style={row}>
    <Button disabled>Add to list</Button>
    <Button variant="secondary" disabled>Sync now</Button>
    <Button variant="outline" disabled>Edit entry</Button>
  </div>
);
