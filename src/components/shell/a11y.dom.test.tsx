import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import ActionSheet from "./ActionSheet";
import ContextMenu from "./ContextMenu";
import SyncPanel from "./SyncPanel";
import DetectionPopup from "./DetectionPopup";
import BottomBar from "./BottomBar";
import Titlebar from "./Titlebar";
import Sidebar from "./Sidebar";
import CommandPalette from "./CommandPalette";
import KeyboardSheet from "./KeyboardSheet";
import FirstRun from "./FirstRun";
import SessionExpired from "./SessionExpired";
import Toast from "./Toast";
import type { Action } from "@/lib/actions";
import { renderWithProviders, signIn, signOut } from "@/test/render";
import { entry, listResult, nowPlaying } from "@/test/fixtures";
import { useNowPlaying } from "@/stores/nowPlaying";
import { useAuth } from "@/stores/auth";
import { showToast, useToast } from "@/stores/toast";
import { checkA11y } from "@/test/a11y";

/** The frame around every screen, graded by axe once per piece; what the lint rules argue with, axe measures. */

const ACTIONS: Action[] = [
  { id: "open", group: "item" },
  { id: "plusOne", group: "item" },
  {
    id: "setStatus",
    group: "edit",
    items: [{ id: "setStatus", group: "edit", arg: { kind: "status", status: "COMPLETED" } }],
  },
  { id: "removeFromList", group: "edit", danger: true },
  { id: "back", group: "app" },
];
const noop = () => {};

afterEach(() => {
  useNowPlaying.setState({ current: null });
  useToast.getState().dismiss();
  signOut();
  vi.restoreAllMocks();
});

async function passes(ui: React.ReactElement, prepare?: (r: ReturnType<typeof renderWithProviders>) => void) {
  const rendered = renderWithProviders(ui);
  prepare?.(rendered);
  expect(await checkA11y(rendered.baseElement)).toHaveNoViolations();
}

describe("the shell passes axe", () => {
  it("ActionSheet", async () => {
    await passes(<ActionSheet title="Cowboy Bebop" actions={ACTIONS} mediaType="ANIME" onRun={noop} onClose={noop} />);
  });

  it("ContextMenu", async () => {
    await passes(<ContextMenu x={20} y={20} actions={ACTIONS} mediaType="ANIME" onRun={noop} onClose={noop} />);
  });

  it("SyncPanel, shut", async () => {
    signIn();
    await passes(
      <SyncPanel label="Show sync details">
        <span>1 change queued</span>
      </SyncPanel>,
    );
  });

  it("DetectionPopup, expanded over a cached title", async () => {
    const viewer = signIn();
    await passes(<DetectionPopup />, (r) => {
      r.queryClient.setQueryData(["mediaList", "ANIME", viewer.id], listResult([entry()]));
      act(() => useNowPlaying.setState({ current: nowPlaying() }));
    });
  });

  it("BottomBar", async () => {
    signIn();
    await passes(<BottomBar />);
  });

  it("Titlebar", async () => {
    signIn();
    await passes(<Titlebar />);
  });

  it("Sidebar", async () => {
    signIn();
    await passes(<Sidebar />);
  });

  it("CommandPalette, open", async () => {
    signIn();
    await passes(<CommandPalette />, () => {
      act(() => {
        window.dispatchEvent(new Event("open-command-palette"));
      });
    });
    expect(screen.getByRole("combobox", { name: "palette.placeholder" })).toBeInTheDocument();
  });

  it("KeyboardSheet, open", async () => {
    await passes(<KeyboardSheet />, () => {
      fireEvent.keyDown(window, { key: "?" });
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("FirstRun", async () => {
    await passes(<FirstRun />);
  });

  it("SessionExpired", async () => {
    signIn();
    await passes(<SessionExpired />, () => {
      act(() => useAuth.setState({ sessionExpired: true }));
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("Toast, with an action", async () => {
    await passes(<Toast />, () => {
      act(() => showToast({ kind: "success", text: "Saved", detail: "Episode 5", action: { label: "Undo", run: noop } }));
    });
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });
});
