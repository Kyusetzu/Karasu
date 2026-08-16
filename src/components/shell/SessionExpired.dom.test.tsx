import { afterEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import SessionExpired from "./SessionExpired";
import { useAuth } from "@/stores/auth";
import { renderWithProviders, signIn, signOut, useLocalProfile } from "@/test/render";

/**
 * One banner for a rejected token, and the three cases where there must not be
 * one. The condition is a property of the session, not of any screen — which is
 * why it lives above the whole shell.
 */

afterEach(signOut);

const expire = () => useAuth.setState({ sessionExpired: true });

describe("SessionExpired", () => {
  it("is absent while the session is fine", () => {
    signIn();
    const { container } = renderWithProviders(<SessionExpired />);
    expect(container.firstChild).toBeNull();
  });

  it("says what happened and offers the fix", () => {
    signIn();
    expire();
    renderWithProviders(<SessionExpired />);
    expect(screen.getByText("auth.expiredTitle")).toBeTruthy();
    expect(screen.getByRole("button", { name: "auth.expiredAction" })).toBeTruthy();
    // A status region, not an alert: the cached list is still readable and the
    // banner must not steal focus from whatever the user was doing.
    expect(screen.getByRole("status")).toBeTruthy();
  });

  /**
   * The account-free profile has no token to reject, and signed out already
   * shows the sign-in screen — a banner there would be asking for what is
   * already on offer. Both are reachable because the flag is plain state.
   */
  it("stays out of local mode and of signed out", () => {
    useLocalProfile();
    expire();
    const { container, unmount } = renderWithProviders(<SessionExpired />);
    expect(container.firstChild).toBeNull();
    unmount();

    signOut();
    expire();
    const second = renderWithProviders(<SessionExpired />);
    expect(second.container.firstChild).toBeNull();
  });
});

describe("reportSessionExpired", () => {
  /**
   * A screen fires several queries and every one of them fails, so this is
   * called in a burst. Setting an already-set flag would re-render every
   * subscriber for nothing.
   */
  it("is idempotent", () => {
    signIn();
    const before = useAuth.getState();
    before.reportSessionExpired();
    const once = useAuth.getState();
    once.reportSessionExpired();
    expect(useAuth.getState().sessionExpired).toBe(true);
    expect(useAuth.getState()).toBe(once);
  });
});
