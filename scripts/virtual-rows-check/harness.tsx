// The page `virtual-rows-check.mjs` drives. Two `VirtualRows` in one scroller,
// which is the arrangement the local library uses and the one nothing else can
// check: jsdom has no layout, so a unit test there mounts zero rows and every
// assertion passes vacuously.
import { createRoot } from "react-dom/client";
import { useRef, useState } from "react";
import { VirtualRows } from "@/components/list/VirtualRows";

const ROW = 68;
const make = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, i }));

function App() {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Held above the rows on purpose: this mirrors the page, where a row that
  // scrolls out of view is unmounted and would lose state kept inside it.
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [tall, setTall] = useState(false);

  const row =
    (label: string) =>
    (item: { id: string; i: number }, _index: number, last: boolean) => (
      <div
        data-testid={item.id}
        data-last={last}
        style={{
          height: open.has(item.id) ? 200 : ROW,
          borderBottom: last ? "none" : "1px solid #333",
        }}
        onClick={() =>
          setOpen((prev) => {
            const next = new Set(prev);
            if (!next.delete(item.id)) next.add(item.id);
            return next;
          })
        }
      >
        {label} {item.i}
      </div>
    );

  return (
    <div ref={scrollRef} id="scroller" style={{ height: 600, overflowY: "auto" }}>
      <p id="notice" style={{ height: tall ? 400 : 40, margin: 0 }}>notice</p>
      <button id="grow" onClick={() => setTall((v) => !v)}>grow</button>
      <p>SECTION A</p>
      <VirtualRows items={make(500, "a")} scrollRef={scrollRef} estimateRowHeight={ROW}
        getKey={(x) => x.id} renderItem={row("A")} />
      <p>SECTION B</p>
      <VirtualRows items={make(500, "b")} scrollRef={scrollRef} estimateRowHeight={ROW}
        getKey={(x) => x.id} renderItem={row("B")} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
