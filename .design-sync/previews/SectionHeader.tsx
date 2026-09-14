import { SectionHeader } from "karasu";
import { CalendarDays, Sparkles, Tv } from "lucide-react";

const col = { display: "flex", flexDirection: "column" as const, gap: 20, padding: 16, minWidth: 0 };

export const Default = () => (
  <div style={col}>
    <SectionHeader icon={Tv} title="Continue watching" />
    <SectionHeader icon={CalendarDays} title="Airing this week" meta="8 episodes" />
    <SectionHeader icon={Sparkles} title="Recommended for you" meta="from your completed titles" />
  </div>
);

export const LongTitle = () => (
  <div style={{ ...col, maxWidth: 360 }}>
    <SectionHeader
      icon={Tv}
      title="A very long section title that has to truncate before the rule takes over the remaining width"
      meta="3 titles"
    />
  </div>
);
