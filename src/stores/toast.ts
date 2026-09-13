import { create } from "zustand";

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  /** Bumped per toast so the component can re-run its entrance animation. */
  id: number;
  /** `info` is a real outcome that is not yet the promised one, so a queued write never shows the green check. */
  kind: "success" | "error" | "info";
  text: string;
  /** Second line — the consequence, not a repeat of the first. */
  detail?: string;
  action?: ToastAction;
}

interface ToastState {
  toast: Toast | null;
  show: (toast: Omit<Toast, "id">) => void;
  dismiss: () => void;
}

/** Long enough to read two lines and reach the button, short enough to be gone before it becomes furniture. */
const DISMISS_MS = 4200;

let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Write receipts, one at a time on purpose: the newest replaces the last, since it is the one still undoable. */
export const useToast = create<ToastState>((set) => ({
  toast: null,

  show: (toast) => {
    clearTimeout(timer);
    set({ toast: { ...toast, id: ++seq } });
    timer = setTimeout(() => set({ toast: null }), DISMISS_MS);
  },

  dismiss: () => {
    clearTimeout(timer);
    set({ toast: null });
  },
}));

/** Callable from outside React — mutation callbacks are not components. */
export const showToast = (toast: Omit<Toast, "id">) =>
  useToast.getState().show(toast);
