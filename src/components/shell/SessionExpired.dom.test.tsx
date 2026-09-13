import { afterEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import SessionExpired from "./SessionExpired";
import { useAuth } from "@/stores/auth";
import { renderWithProviders, signIn, signOut, useLocalProfile } from "@/test/render";

/** Proves one banner for a rejected token and none in the three cases where the session needs no fix. */

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
    // A status region, not an alert: the cached list is still readable and the banner must not steal focus.
    expect(screen.getByRole("status")).toBeTruthy();
  });

  /** Proves the banner stays off where there is no token to reject or the sign-in screen is already showing. */
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
  /** Proves a burst of failed queries sets the flag once, so subscribers are not re-rendered for nothing. */
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
