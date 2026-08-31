import { create } from "zustand";

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  /** Bumped per toast so the component can re-run its entrance animation. */
  id: number;
  /**
   * `info` is for a real outcome that is not yet the promised one — a save
   * that went to the offline queue rather than to AniList. It exists so the
   * green check cannot be shown for a write the server has not seen.
   */
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

/** Long enough to read two lines and reach the button, short enough that it is
    gone before it becomes furniture. */
const DISMISS_MS = 4200;

let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Write receipts.
 *
 * Every optimistic write needs a visible, reversible receipt: the UI has
 * already claimed the change succeeded, so without one a failure is a silent
 * lie and a mistake has no way back.
 *
 * One toast at a time, deliberately. A +1 held down produces a burst of writes,
 * and a stack would turn that into a wall — the newest receipt replaces the
 * previous one and restarts the clock, because it is the one still undoable.
 */
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
