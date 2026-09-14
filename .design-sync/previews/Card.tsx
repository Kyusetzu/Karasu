import { Button, Card, CardTitle } from "karasu";

export const Panel = () => (
  <div style={{ padding: 16 }}>
    <Card>
      <CardTitle>This week</CardTitle>
      <p className="mt-1 text-sm text-ink-300">Six episodes air before Sunday; two of them are titles you are watching.</p>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <Button size="sm">Open calendar</Button>
        <Button size="sm" variant="ghost">Dismiss</Button>
      </div>
    </Card>
  </div>
);

export const Stats = () => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, padding: 16 }}>
    {[["523", "Anime"], ["146", "Manga"], ["7.1", "Mean score"]].map(([n, l]) => (
      <Card key={l} className="p-4">
        <div className="text-2xl font-bold text-ink-100">{n}</div>
        <div className="text-2xs uppercase tracking-[.09em] text-ink-600">{l}</div>
      </Card>
    ))}
  </div>
);
