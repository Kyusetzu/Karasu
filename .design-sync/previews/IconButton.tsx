import { IconButton } from "karasu";
import { Check, Heart, MoreHorizontal, Pencil, Play, Plus, X } from "lucide-react";

const row = { display: "flex", flexWrap: "wrap" as const, gap: 10, alignItems: "center", padding: 16 };

export const Variants = () => (
  <div style={row}>
    <IconButton aria-label="More"><MoreHorizontal className="size-4" /></IconButton>
    <IconButton variant="surface" aria-label="Edit"><Pencil className="size-4" /></IconButton>
    <IconButton variant="accent" aria-label="Add"><Plus className="size-4" /></IconButton>
    <IconButton variant="success" aria-label="Mark watched"><Check className="size-4" /></IconButton>
    <IconButton variant="danger" aria-label="Remove"><X className="size-4" /></IconButton>
  </div>
);

export const Sizes = () => (
  <div style={row}>
    <IconButton variant="surface" size="control" aria-label="Edit"><Pencil className="size-4" /></IconButton>
    <IconButton variant="surface" size="sm" aria-label="Edit"><Pencil className="size-3.5" /></IconButton>
    <IconButton variant="surface" size="xs" aria-label="Edit"><Pencil className="size-3.5" /></IconButton>
  </div>
);

export const OnCover = () => (
  <div style={{ padding: 16 }}>
    <div
      style={{ width: 150, height: 210, borderRadius: 8, background: "linear-gradient(160deg, #3b2f8f, #b33f7a)", position: "relative" }}
    >
      <div style={{ position: "absolute", right: 8, bottom: 8, display: "flex", gap: 6 }}>
        <IconButton variant="onCover" size="sm" round aria-label="Play"><Play className="size-3.5" /></IconButton>
        <IconButton variant="onCover" size="sm" round aria-label="Favourite"><Heart className="size-3.5" /></IconButton>
      </div>
    </div>
  </div>
);
