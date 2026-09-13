import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ReactElement, ReactNode } from "react";
import { useAuth } from "@/stores/auth";
import type { Viewer } from "@/api/types";

/** The component-test wrapper; it imports Testing Library, so nothing in the node test project may import it. */

/** Retries off and no cache between tests, so a failure is this test's own. */
function client(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

// Return type inferred, not `RenderResult`: naming it invites a second copy of `@testing-library/dom`'s types.
export function renderWithProviders(
  ui: ReactElement,
  { route = "/" }: { route?: string } = {},
) {
  const queryClient = client();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return { ...render(ui, { wrapper: Wrapper }), queryClient };
}

const VIEWER: Viewer = {
  id: 6421433,
  name: "Kyusetzu",
  siteUrl: "https://anilist.co/user/Kyusetzu",
  avatar: { large: null },
};

/** Drives the real Zustand store rather than a mock, so a component cannot read a shape the store cannot produce. */
export function signIn(overrides: Partial<Viewer> = {}): Viewer {
  const viewer = { ...VIEWER, ...overrides };
  useAuth.setState({ viewer, mode: "anilist", loading: false });
  return viewer;
}

export function signOut(): void {
  // `sessionExpired` too, mirroring the real `logout`; left set, later tests would depend on the order they ran in.
  useAuth.setState({
    viewer: null,
    mode: "none",
    loading: false,
    sessionExpired: false,
  });
}

export function useLocalProfile(): void {
  useAuth.setState({ viewer: null, mode: "local", loading: false });
}
