import { Button, Card, CardTitle, KarasuTheme, Pill } from "karasu";

const sample = (
  <div style={{ padding: 16 }}>
    <Card>
      <CardTitle>Airing this week</CardTitle>
      <p className="mt-1 text-sm text-ink-300">Six episodes before Sunday. Two of them are yours.</p>
      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <Pill active>Watching</Pill>
        <Pill>Planning</Pill>
        <Button size="sm">Open calendar</Button>
      </div>
    </Card>
  </div>
);

export const Dark = () => <KarasuTheme theme="dark">{sample}</KarasuTheme>;
export const Light = () => <KarasuTheme theme="light">{sample}</KarasuTheme>;
export const Accent = () => <KarasuTheme theme="dark" accent="#0d7a54">{sample}</KarasuTheme>;
