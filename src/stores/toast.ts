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
  /** Stops the clock while a pointer rests on the toast or focus is inside it. */
  pause: () => void;
  /** Restarts the clock with what was left, never less than `RESUME_MIN_MS`. */
  resume: () => void;
}

/** Long enough to read two lines, short enough to be gone before it becomes furniture. */
const DISMISS_MS = 4200;
/** A toast with Undo stays longer, since reading it and then reaching the button is the whole point of it. */
const ACTION_DISMISS_MS = 7000;
/** What a paused toast keeps after the pointer leaves, so it does not vanish the instant it is let go. */
const RESUME_MIN_MS = 1500;

let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let deadline = 0;
let remaining: number | null = null;

/** Write receipts, one at a time on purpose: the newest replaces the last, since it is the one still undoable. */
export const useToast = create<ToastState>((set, get) => {
  const arm = (ms: number) => {
    clearTimeout(timer);
    remaining = null;
    deadline = Date.now() + ms;
    timer = setTimeout(() => set({ toast: null }), ms);
  };

  return {
    toast: null,

    show: (toast) => {
      set({ toast: { ...toast, id: ++seq } });
      arm(toast.action ? ACTION_DISMISS_MS : DISMISS_MS);
    },

    dismiss: () => {
      clearTimeout(timer);
      remaining = null;
      set({ toast: null });
    },

    pause: () => {
      if (!get().toast || remaining !== null) return;
      clearTimeout(timer);
      remaining = Math.max(0, deadline - Date.now());
    },

    resume: () => {
      if (!get().toast || remaining === null) return;
      arm(Math.max(remaining, RESUME_MIN_MS));
    },
  };
});

/** Callable from outside React — mutation callbacks are not components. */
export const showToast = (toast: Omit<Toast, "id">) =>
  useToast.getState().show(toast);
