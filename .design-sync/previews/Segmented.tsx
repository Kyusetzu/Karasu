import { Segmented } from "karasu";
import { CalendarDays, LayoutGrid, List, Rows3 } from "lucide-react";

export const Views = () => (
  <div style={{ display: "flex", gap: 16, padding: 16, alignItems: "center", flexWrap: "wrap" }}>
    <Segmented
      aria-label="Calendar view"
      segments={[{ value: "week", label: "Week" }, { value: "tiles", label: "Tiles" }, { value: "agenda", label: "Agenda" }]}
      value="week"
      onChange={() => {}}
    />
    <Segmented
      aria-label="List layout"
      segments={[
        { value: "grid", label: <LayoutGrid className="size-3.5" />, title: "Grid" },
        { value: "rows", label: <Rows3 className="size-3.5" />, title: "Rows" },
      ]}
      value="grid"
      onChange={() => {}}
    />
    <Segmented
      aria-label="Scope"
      segments={[
        { value: "mine", label: <span className="inline-flex items-center gap-1.5"><List className="size-3.5" /> Mine</span> },
        { value: "all", label: <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-3.5" /> Everything</span> },
      ]}
      value="all"
      onChange={() => {}}
    />
  </div>
);
