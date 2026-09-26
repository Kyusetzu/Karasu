import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import type { HeroMedia } from "@/api/queries";
import { useContentFilter } from "@/stores/contentFilter";
import { renderWithProviders } from "@/test/render";

const hero = vi.fn<() => Promise<HeroMedia[]>>();

vi.mock("@/api/anilist", async (orig) => ({
  ...(await orig<typeof import("@/api/anilist")>()),
  isTauri: true,
}));

vi.mock("@/api/queries", async (orig) => ({
  ...(await orig<typeof import("@/api/queries")>()),
  seasonHero: () => hero(),
}));

import SeasonHero from "./SeasonHero";

const media = (id: number, romaji: string, over: Partial<HeroMedia> = {}): HeroMedia => ({
  id,
  type: "ANIME",
  title: { romaji, english: null, native: null },
  bannerImage: `https://s4.anilist.co/banner/${id}.jpg`,
  coverImage: { extraLarge: null, large: null },
  format: "TV",
  status: "FINISHED",
  episodes: 12,
  nextAiringEpisode: null,
  averageScore: 80,
  genres: [],
  isAdult: false,
  ...over,
});

const heading = () => screen.getByRole("heading", { level: 2 }).textContent;
/** The card the gestures are bound to: the first child of the section. */
const card = (root: HTMLElement) => root.querySelector("section > div") as HTMLElement;

/** jsdom has no `TouchEvent`; the swipe reads `touches[0]`'s two coordinates and nothing else. */
function touch(type: string, x: number, y: number, count = 1): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: Array.from({ length: count }, () => ({ clientX: x, clientY: y })),
  });
  return event;
}

function swipe(target: HTMLElement, dx: number, dy = 0, x = 500, y = 300) {
  act(() => {
    target.dispatchEvent(touch("touchstart", x, y));
    target.dispatchEvent(touch("touchmove", x + dx / 5, y + dy / 5));
    target.dispatchEvent(touch("touchmove", x + dx, y + dy));
    target.dispatchEvent(touch("touchend", x + dx, y + dy, 0));
  });
}

/** jsdom has no `PointerEvent` either; the drag reads the type, the button, the id and the coordinates. */
function pointer(type: string, x: number, y: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({ pointerType: "mouse", button: 0, pointerId: 1, clientX: x, clientY: y })) {
    Object.defineProperty(event, key, { value });
  }
  return event;
}

/** A mouse drag by `dx`, ending in the click the browser sends on release. */
function drag(target: HTMLElement, dx: number, x = 500, y = 300) {
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(pointer("pointerdown", x, y));
    target.dispatchEvent(pointer("pointermove", x + dx / 5, y));
    target.dispatchEvent(pointer("pointermove", x + dx, y));
    target.dispatchEvent(pointer("pointerup", x + dx, y));
    target.dispatchEvent(click);
  });
}

function wheel(deltaX: number, deltaY: number, timeStamp: number): Event {
  const event = new Event("wheel", { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({ deltaX, deltaY, deltaMode: 0, timeStamp })) {
    Object.defineProperty(event, key, { value });
  }
  return event;
}

beforeEach(() => {
  hero.mockReset();
  useContentFilter.setState({ level: "off", ready: true, error: null });
});

/** jsdom implements no pointer capture; the drag only asks for it and never reads it back. */
Object.assign(HTMLElement.prototype, { hasPointerCapture: () => false, setPointerCapture: () => {} });

afterEach(() => {
  vi.useRealTimers();
  useContentFilter.setState({ level: "strict", ready: false, error: null });
});

describe("SeasonHero", () => {
  it("links the title to the entry", async () => {
    hero.mockResolvedValue([media(1, "Frieren")]);
    renderWithProviders(<SeasonHero />);
    const link = await screen.findByRole("link", { name: "Frieren" });
    // `renderWithProviders` uses a MemoryRouter, so no hash prefix here.
    expect(link).toHaveAttribute("href", "/media/1");
  });

  /** A running show counts what has aired; the same total twice read as a finished season. */
  it("counts a running show's aired episodes against its total", async () => {
    hero.mockResolvedValue([
      media(1, "Mushoku", { status: "RELEASING", episodes: 14, nextAiringEpisode: { episode: 14 } }),
    ]);
    renderWithProviders(<SeasonHero />);
    expect(await screen.findByText('dashboard.heroAired:{"n":13,"total":14}')).toBeInTheDocument();
  });

  it("gives a finished show its total", async () => {
    hero.mockResolvedValue([media(1, "Tanya")]);
    renderWithProviders(<SeasonHero />);
    expect(await screen.findByText('dashboard.heroEpisodes:{"n":12}')).toBeInTheDocument();
  });

  /** Nothing is a better hero than a broken one. */
  it("renders nothing at all when the season came back empty", async () => {
    hero.mockResolvedValue([]);
    const { container } = renderWithProviders(<SeasonHero />);
    await waitFor(() => expect(container.querySelector("section")).toBeNull());
  });

  /** Proves the genre rule, which the query argument cannot cover, runs on the hero too. */
  it("drops a title the content filter blocks", async () => {
    useContentFilter.setState({ level: "moderate", ready: true, error: null });
    hero.mockResolvedValue([media(1, "Blocked", { isAdult: true }), media(2, "Fine")]);
    renderWithProviders(<SeasonHero />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Fine" })).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "Blocked" })).toBeNull();
  });

  it("offers one dot per title and no arrows, and nothing for a single one", async () => {
    hero.mockResolvedValue([media(1, "A"), media(2, "B"), media(3, "C")]);
    const { unmount } = renderWithProviders(<SeasonHero />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "A" })).toBeInTheDocument(),
    );
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["A", "B", "C"]);
    unmount();

    hero.mockResolvedValue([media(9, "Only")]);
    renderWithProviders(<SeasonHero />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Only" })).toBeInTheDocument());
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  /** A slide mounts only as the active one or its successor, and stays once seen, since unmounting drops the decode. */
  it("mounts a slide only once it is needed, and a swipe steps and wraps both ways", async () => {
    hero.mockResolvedValue([media(1, "A"), media(2, "B"), media(3, "C")]);
    const { container } = renderWithProviders(<SeasonHero />);
    await waitFor(() => expect(heading()).toBe("A"));
    // Probed by the img, not by role: an inactive slide is aria-hidden, so by name it looks unmounted.
    expect(container.querySelector('img[src*="banner/3"]')).toBeNull();

    swipe(card(container), -160);
    expect(heading()).toBe("B");
    // B's successor is C, so its banner exists now, preloaded for the crossfade and still hidden.
    expect(container.querySelector('img[src*="banner/3"]')).toBeInTheDocument();

    // Backwards from the second, twice: past the first, wrapping to the last.
    swipe(card(container), 160);
    swipe(card(container), 160);
    expect(heading()).toBe("C");
    // And forwards past the last, back to the first: the swipe is as endless as the rotation.
    swipe(card(container), -160);
    expect(heading()).toBe("A");
  });

  it("leaves a vertical drag to the page", async () => {
    hero.mockResolvedValue([media(1, "A"), media(2, "B")]);
    const { container } = renderWithProviders(<SeasonHero />);
    await waitFor(() => expect(heading()).toBe("A"));
    swipe(card(container), 10, 160);
    expect(heading()).toBe("A");
  });

  /** The whole banner is a link, so the click a mouse drag ends with must not open the title it was dragged across. */
  it("steps on a mouse drag without following the link under it", async () => {
    hero.mockResolvedValue([media(1, "A"), media(2, "B")]);
    const { container } = renderWithProviders(<SeasonHero />);
    await waitFor(() => expect(heading()).toBe("A"));
    // The router's link handles a click on its way up, so a click that never gets past the card opened nothing.
    const reached = vi.fn();
    window.addEventListener("click", reached);
    const slide = container.querySelector<HTMLAnchorElement>('a[href="/media/1"][tabindex="0"]')!;
    drag(slide, -160);
    expect(heading()).toBe("B");
    expect(reached).not.toHaveBeenCalled();

    // A plain click, with no drag before it, still goes through to the link.
    act(() => {
      slide.dispatchEvent(pointer("pointerdown", 500, 300));
      slide.dispatchEvent(pointer("pointerup", 500, 300));
      slide.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(reached).toHaveBeenCalledTimes(1);
    window.removeEventListener("click", reached);
  });

  /** A trackpad's sideways swipe arrives as a run of wheel events and a momentum tail; together they are one step. */
  it("steps once per sideways trackpad swipe", async () => {
    hero.mockResolvedValue([media(1, "A"), media(2, "B"), media(3, "C")]);
    const { container } = renderWithProviders(<SeasonHero />);
    await waitFor(() => expect(heading()).toBe("A"));
    const events = Array.from({ length: 20 }, (_, i) => wheel(30, 0, 1000 + i * 16));
    act(() => events.forEach((e) => card(container).dispatchEvent(e)));
    expect(heading()).toBe("B");
    expect(events[0].defaultPrevented).toBe(true);

    // A vertical scroll is the page's: no step, and nothing prevented.
    const down = wheel(0, 80, 5000);
    act(() => void card(container).dispatchEvent(down));
    expect(heading()).toBe("B");
    expect(down.defaultPrevented).toBe(false);
  });

  it("holds the rotation while a pointer rests on it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    hero.mockResolvedValue([media(1, "First"), media(2, "Second")]);
    const { container } = renderWithProviders(<SeasonHero />);
    await waitFor(() => expect(heading()).toBe("First"));
    act(() => void card(container).dispatchEvent(pointer("pointerdown", 500, 300)));
    await act(async () => {
      vi.advanceTimersByTime(7000);
    });
    expect(heading()).toBe("First");
    // Released outside the hero: the rotation starts again, with a full hold for the slide now showing.
    act(() => void window.dispatchEvent(pointer("pointerup", 900, 900)));
    await act(async () => {
      vi.advanceTimersByTime(7000);
    });
    expect(heading()).toBe("Second");
  });

  it("advances on its own", async () => {
    // Faked before the render, or the mount effect's timer stays real; `shouldAdvanceTime` lets the query settle.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    hero.mockResolvedValue([media(1, "First"), media(2, "Second")]);
    renderWithProviders(<SeasonHero />);
    // The heading is the current slide; both stay mounted, so the heading has to change rather than the link set.
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("First"),
    );
    await act(async () => {
      vi.advanceTimersByTime(7000);
    });
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Second");
  });

  // No reduced-motion hold, deliberately: advancing is content, not motion, and the crossfade is what the CSS cuts.
});

describe("SeasonHero banner", () => {
  /** Contained over a blur of itself: the whole picture shows, and nothing is stretched to fill the frame. */
  it("draws the banner whole on top of its own blurred fill", async () => {
    hero.mockResolvedValue([media(1, "Frieren")]);
    const { container } = renderWithProviders(<SeasonHero />);
    await screen.findByRole("link", { name: "Frieren" });
    const images = [...container.querySelectorAll("img")].filter((i) => i.src.endsWith("/banner/1.jpg"));
    expect(images).toHaveLength(2);
    expect(images.some((i) => i.classList.contains("object-contain"))).toBe(true);
    expect(images.some((i) => i.classList.contains("object-cover") && i.className.includes("blur"))).toBe(true);
  });

  it("shows only the blurred fill behind the adult veil", async () => {
    useContentFilter.setState({ level: "off", ready: true, error: null, blurAdult: true });
    hero.mockResolvedValue([media(1, "Veiled", { isAdult: true })]);
    const { container } = renderWithProviders(<SeasonHero />);
    await screen.findByRole("link", { name: "Veiled" });
    const images = [...container.querySelectorAll("img")].filter((i) => i.src.endsWith("/banner/1.jpg"));
    expect(images).toHaveLength(1);
    expect(images[0].classList.contains("object-contain")).toBe(false);
  });
});
