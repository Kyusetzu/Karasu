import { Button, Input, Modal } from "karasu";

export const EditEntry = () => (
  <Modal title="Frieren: Beyond Journey's End" onClose={() => {}}>
    <div style={{ display: "grid", gap: 12 }}>
      <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
        <span className="text-ink-600">Progress</span>
        <Input defaultValue="14 / 28" />
      </label>
      <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
        <span className="text-ink-600">Notes</span>
        <Input placeholder="Private notes, only you see them" />
      </label>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
        <Button variant="ghost">Cancel</Button>
        <Button>Save</Button>
      </div>
    </div>
  </Modal>
);

export const Confirm = () => (
  <Modal title="Remove from list?" onClose={() => {}} className="max-w-sm">
    <p className="text-sm text-ink-300">
      This removes the entry and its progress from your AniList account. It can be undone from the toast.
    </p>
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
      <Button variant="ghost">Keep</Button>
      <Button variant="danger">Remove</Button>
    </div>
  </Modal>
);
