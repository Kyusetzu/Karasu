import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ReactElement, ReactNode } from "react";
import { useAuth } from "@/stores/auth";
import type { Viewer } from "@/api/types";

/**
 * The wrapper every component test needs, and the store state most of them set.
 *
 * Lives outside `src/lib` on purpose: it imports Testing Library, so it must
 * never be reachable from the node test project. Only `*.dom.test.tsx` files
 * import it — see the projects block in `vite.config.ts`.
 */

/** Retries off and no cache between tests, so a failure is this test's own. */
function client(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

// Return type inferred rather than annotated as `RenderResult`: Testing
// Library's own type is assembled from `@testing-library/dom`'s query set, and
// naming it here invites a second copy of those types into the graph.
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

/**
 * Drives the real Zustand store rather than mocking the module.
 *
 * A mock would let a component read a shape the store cannot actually produce;
 * setting real state cannot. `useAuth` is a plain store with no IPC in its
 * setter, so this is just an assignment.
 */
export function signIn(overrides: Partial<Viewer> = {}): Viewer {
  const viewer = { ...VIEWER, ...overrides };
  useAuth.setState({ viewer, mode: "anilist", loading: false });
  return viewer;
}

export function signOut(): void {
  // `sessionExpired` too, mirroring the real `logout`. It is plain state that
  // nothing else resets, so an `afterEach(signOut)` that left it set would make
  // every later test in the file depend on the order it ran in.
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
