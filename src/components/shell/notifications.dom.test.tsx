import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router";
import type { AppNotification } from "@/api/anilist";
import type { SiteNotifPage } from "@/api/social";
import type { SiteNotifRow } from "@/lib/siteNotifications";
import { renderWithProviders, signIn, signOut, useLocalProfile } from "@/test/render";
import { checkA11y } from "@/test/a11y";

const data = vi.hoisted(() => ({
  local: [] as AppNotification[],
  site: [] as SiteNotifRow[],
  // A second AniList page, offered behind "Load more" when set.
  more: [] as SiteNotifRow[],
  count: 0,
}));

vi.mock("@/api/anilist", async (orig) => ({
  ...(await orig<typeof import("@/api/anilist")>()),
  isTauri: true,
  getNotifications: vi.fn(async () => data.local),
  markNotificationRead: vi.fn(async () => {}),
  markAllNotificationsRead: vi.fn(async () => {}),
}));

vi.mock("@/api/social", async (orig) => ({
  ...(await orig<typeof import("@/api/social")>()),
  siteNotifCount: vi.fn(async () => data.count),
  siteNotifications: vi.fn(
    async (page: number): Promise<SiteNotifPage> => ({
      pageInfo: { total: 0, currentPage: page, lastPage: 2, hasNextPage: page === 1 && data.more.length > 0 },
      rows: page === 1 ? data.site : data.more,
    }),
  ),
}));

import Bell from "./Bell";
import BottomBar from "./BottomBar";
import Notifications from "@/pages/Notifications";
import { siteNotifications } from "@/api/social";

const HOUR = 60 * 60 * 1000;

const local = (id: number, agoMs: number): AppNotification => ({
  id,
  kind: "stale",
  title: `Local ${id}`,
  body: "Untouched for a while",
  createdMs: Date.now() - agoMs,
  mediaId: 100 + id,
  read: false,
});

const follow = (id: number, name: string): SiteNotifRow => ({
  id,
  kind: "FOLLOWING",
  createdAt: Math.floor(Date.now() / 1000) - 60,
  title: name,
  actorName: name,
  episode: null,
  detail: null,
  target: `/user/${name}`,
  userId: id,
  mediaId: null,
  activityId: null,
  media: null,
});

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

afterEach(() => {
  data.local = [];
  data.site = [];
  data.more = [];
  data.count = 0;
  vi.mocked(siteNotifications).mockClear();
  signOut();
});

/** The bell in its three places: the titlebar's glance, the phone's tall sheet and the page they lead to. */
describe("notifications", () => {
  it("glances at the newest three in the titlebar and leads to the page for the rest", async () => {
    const user = userEvent.setup({ delay: null });
    useLocalProfile();
    data.local = [1, 2, 3, 4, 5].map((id) => local(id, id * HOUR));
    const { baseElement } = renderWithProviders(
      <>
        <Bell />
        <Where />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "notif.title" }));
    const panel = await screen.findByRole("dialog", { name: "notif.title" });
    await waitFor(() => expect(within(panel).getAllByText(/^Local \d$/)).toHaveLength(3));
    expect(within(panel).getByText("Local 1")).toBeInTheDocument();
    expect(within(panel).queryByText("Local 4")).toBeNull();
    expect(await checkA11y(baseElement)).toHaveNoViolations();
    await user.click(within(panel).getByRole("button", { name: "notif.all" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/notifications"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "notif.title" })).toBeNull());
  });

  it("opens the phone's own tall sheet from More, which steps aside for it", async () => {
    const user = userEvent.setup({ delay: null });
    useLocalProfile();
    data.local = [local(1, 60_000), local(2, 72 * HOUR)];
    const { baseElement } = renderWithProviders(<BottomBar />);
    await user.click(screen.getByRole("button", { name: /nav\.more/ }));
    const more = await screen.findByRole("dialog", { name: "nav.more" });
    await user.click(within(more).getByRole("button", { name: "notif.title" }));
    const sheet = await screen.findByRole("dialog", { name: "notif.title" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "nav.more" })).toBeNull());
    // Today above earlier, each under its own label.
    await waitFor(() => expect(within(sheet).getByText("Local 1")).toBeInTheDocument());
    expect(within(sheet).getByText("notif.today")).toBeInTheDocument();
    expect(within(sheet).getByText("notif.earlier")).toBeInTheDocument();
    expect(await checkA11y(baseElement)).toHaveNoViolations();
  });

  it("filters the page by source, and offers no filter where there is only one", async () => {
    const user = userEvent.setup({ delay: null });
    signIn();
    data.local = [local(1, HOUR)];
    data.site = [follow(7, "Hoshi")];
    const { unmount, baseElement } = renderWithProviders(<Notifications />);
    expect(await screen.findByText("Hoshi")).toBeInTheDocument();
    expect(await screen.findByText("Local 1")).toBeInTheDocument();
    expect(await checkA11y(baseElement)).toHaveNoViolations();
    await user.click(screen.getByRole("radio", { name: "Karasu" }));
    expect(screen.queryByText("Hoshi")).toBeNull();
    expect(screen.getByText("Local 1")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "AniList" }));
    expect(screen.getByText("Hoshi")).toBeInTheDocument();
    expect(screen.queryByText("Local 1")).toBeNull();
    unmount();

    useLocalProfile();
    renderWithProviders(<Notifications />);
    expect(await screen.findByText("Local 1")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("leaves the page's loaded pages alone when the titlebar glance opens and closes over it", async () => {
    const user = userEvent.setup({ delay: null });
    signIn();
    data.site = [follow(7, "Hoshi")];
    data.more = [follow(8, "Mikan")];
    renderWithProviders(
      <>
        <Bell />
        <Notifications />
      </>,
    );
    expect(await screen.findByText("Hoshi")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "social.loadMorePlain" }));
    expect(await screen.findByText("Mikan")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "notif.title" }));
    await screen.findByRole("dialog", { name: "notif.title" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "notif.title" })).toBeNull());
    // Both pages still drawn, and nothing re-requested: one fetch per page, however many surfaces looked.
    expect(screen.getByText("Mikan")).toBeInTheDocument();
    expect(vi.mocked(siteNotifications)).toHaveBeenCalledTimes(2);
  });

  it("carries AniList's unread marks from the glance onto the page it leads to", async () => {
    const user = userEvent.setup({ delay: null });
    signIn();
    data.count = 1;
    data.site = [follow(7, "Hoshi")];
    renderWithProviders(
      <>
        <Bell />
        <Routes>
          <Route path="/notifications" element={<Notifications />} />
          <Route path="*" element={null} />
        </Routes>
      </>,
    );
    // The badge's count has to be known before the glance's first page spends it.
    await waitFor(() => expect(screen.getByRole("button", { name: "notif.title" })).toHaveTextContent("1"));
    await user.click(screen.getByRole("button", { name: "notif.title" }));
    const panel = await screen.findByRole("dialog", { name: "notif.title" });
    const unreadClass = "bg-surface-850/60";
    expect((await within(panel).findByText("Hoshi")).closest("button")).toHaveClass(unreadClass);
    await user.click(within(panel).getByRole("button", { name: "notif.all" }));
    const page = await screen.findByRole("heading", { level: 1, name: "notif.title" });
    const row = within(page.closest("div.mx-auto") as HTMLElement).getByText("Hoshi").closest("button");
    expect(row).toHaveClass(unreadClass);
  });

  it("offers no AniList paging while the filter shows only Karasu's own", async () => {
    const user = userEvent.setup({ delay: null });
    signIn();
    data.local = [local(1, HOUR)];
    data.site = [follow(7, "Hoshi")];
    data.more = [follow(8, "Mikan")];
    renderWithProviders(<Notifications />);
    expect(await screen.findByRole("button", { name: "social.loadMorePlain" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Karasu" }));
    expect(screen.queryByRole("button", { name: "social.loadMorePlain" })).toBeNull();
  });
});
