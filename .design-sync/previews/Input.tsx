import { Input } from "karasu";

const col = { display: "grid", gap: 12, padding: 16, maxWidth: 420 };

export const States = () => (
  <div style={col}>
    <Input placeholder="Search your list" />
    <Input defaultValue="Frieren" />
    <Input value="Frieren" onChange={() => {}} onClear={() => {}} clearLabel="Clear" />
    <Input disabled placeholder="Disabled" />
  </div>
);

export const Numeric = () => (
  <div style={{ ...col, maxWidth: 200 }}>
    <Input type="number" defaultValue={14} min={0} max={28} />
  </div>
);
