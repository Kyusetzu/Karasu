import { Database, PencilLine, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { FlowDiagram } from "@/components/FlowDiagram";
import { Reveal, Section } from "@/components/Section";
import { Card, CardTitle } from "@/components/ui/card";
import { staggerDelay } from "@/lib/motion";

const STEPS = [
  { icon: Wifi, title: "Online", text: "Your list is fetched and cached in a local SQLite database." },
  { icon: WifiOff, title: "The network goes", text: "The list you had stays readable; a title on it opens with a working +1." },
  { icon: PencilLine, title: "You edit anyway", text: "Progress, status, score — the change is queued, not lost." },
  { icon: Database, title: "The queue waits", text: "Per account, inspectable in Settings, each entry discardable." },
  { icon: RefreshCw, title: "The network returns", text: "Queued edits are sent in order the next time a list opens." },
];

const HONEST = [
  {
    title: "“Queued” is never “saved”",
    text: "The receipt says which one happened. A queued edit is a promise Karasu keeps later, and it tells you so.",
  },
  {
    title: "Only your list is cached",
    text: "Browsing titles you have not added, search and the social pages need the network, and say so instead of pretending.",
  },
  {
    title: "Accounts stay apart",
    text: "Every queued edit is stamped with the account that made it and is only ever sent for that account.",
  },
];

export function Offline() {
  return (
    <Section
      id="offline"
      eyebrow="Offline"
      title="Edits made offline are sent when you are back."
      lede="A tracker that stops working on a train is not much of a tracker. Karasu keeps the list, keeps the edit, and keeps its word about which is which."
    >
      <div className="mt-12">
        <FlowDiagram steps={STEPS} tone="success" />
      </div>
      <div className="mt-14 grid gap-4 md:grid-cols-3">
        {HONEST.map((h, i) => (
          <Reveal key={h.title} delay={staggerDelay(i)}>
            <Card className="h-full">
              <CardTitle className="text-[.9375rem]">{h.title}</CardTitle>
              <p className="mt-2 text-sm leading-relaxed text-ink-500">{h.text}</p>
            </Card>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
