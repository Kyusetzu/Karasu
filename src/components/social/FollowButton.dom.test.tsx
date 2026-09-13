import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FollowButton } from "./FollowButton";
import { renderWithProviders, signIn, signOut, useLocalProfile } from "@/test/render";

/** The button agrees with `lib/follows.test.ts` on every relation state, and is absent where there is nobody to follow as. */

afterEach(signOut);

const OTHER = { userId: 999, name: "chrona" };

describe("FollowButton renders nothing when there is nobody to follow as", () => {
  it("is absent when signed out", () => {
    signOut();
    const { container } = renderWithProviders(<FollowButton {...OTHER} flags={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it("is absent in the account-free local mode", () => {
    // The social graph belongs to an AniList account; a disabled button here would be an invitation with no explanation.
    useLocalProfile();
    const { container } = renderWithProviders(<FollowButton {...OTHER} flags={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it("is absent on your own profile", () => {
    const me = signIn();
    const { container } = renderWithProviders(
      <FollowButton userId={me.id} name={me.name} flags={{}} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("FollowButton states", () => {
  it("offers to follow someone unrelated", () => {
    signIn();
    renderWithProviders(<FollowButton {...OTHER} flags={{}} />);
    const button = screen.getByRole("button");
    expect(button.textContent).toContain("social.follow");
    expect(button.getAttribute("aria-label")).toContain("social.followAria");
  });

  it("offers to follow someone who follows you", () => {
    signIn();
    renderWithProviders(
      <FollowButton {...OTHER} flags={{ isFollower: true, isFollowing: false }} />,
    );
    expect(screen.getByRole("button").textContent).toContain("social.follow");
  });

  it("shows the following state when you follow them", () => {
    signIn();
    renderWithProviders(<FollowButton {...OTHER} flags={{ isFollowing: true }} />);
    expect(screen.getByRole("button").textContent).toContain("social.following");
  });

  it("shows the following state for a mutual follow", () => {
    signIn();
    renderWithProviders(
      <FollowButton {...OTHER} flags={{ isFollowing: true, isFollower: true }} />,
    );
    expect(screen.getByRole("button").textContent).toContain("social.following");
  });

  it("names the action, not the state, for a screen reader", () => {
    // The label reads the state, the accessible name the action: "Following" read aloud implies pressing would follow.
    signIn();
    renderWithProviders(<FollowButton {...OTHER} flags={{ isFollowing: true }} />);
    const button = screen.getByRole("button");
    expect(button.textContent).toContain("social.following");
    expect(button.getAttribute("aria-label")).toContain("social.unfollowAria");
  });

  it("treats null and undefined flags as not following", () => {
    signIn();
    renderWithProviders(
      <FollowButton {...OTHER} flags={{ isFollowing: null, isFollower: null }} />,
    );
    expect(screen.getByRole("button").textContent).toContain("social.follow");
  });
});
