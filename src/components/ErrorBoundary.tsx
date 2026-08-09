import { Component, type ErrorInfo, type ReactNode } from "react";
import { withTranslation, type WithTranslation } from "react-i18next";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyDiagnostics, reportError } from "@/api/diagnostics";

/**
 * The one thing standing between a render throw and an unusable window.
 *
 * Without a boundary React 19 unmounts from the root, and because `Titlebar`,
 * `Sidebar` and `Toast` are siblings inside the same subtree they go with it —
 * including the titlebar's X, which is what calls `close()` so Rust can decide
 * hide-versus-quit. The result was a blank window the user could not close, with
 * no console to read and nothing written anywhere.
 *
 * Two of these are mounted. The **inner** one wraps only the routed pane, so a
 * page that throws leaves the frame around it alive and the app still
 * navigable — that is the one that does the work. The **outer** one is the last
 * resort for a throw in the shell itself, where there is nothing left to keep.
 *
 * A class, because `componentDidCatch` has no hook equivalent; this is the one
 * place in the app that is not a function component.
 */
interface Props extends WithTranslation {
  children: ReactNode;
  /** Shown when the shell itself is gone, so the fallback stands alone. */
  standalone?: boolean;
}

interface State {
  error: Error | null;
  copied: boolean;
}

class ErrorBoundaryInner extends Component<Props, State> {
  state: State = { error: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Straight to the Rust log, so a UI crash sits in the same file as whatever
    // the backend was doing at the time — which is usually how the connection
    // between the two becomes visible.
    reportError(error, info.componentStack ?? undefined);
  }

  render() {
    const { error } = this.state;
    const { t, children, standalone } = this.props;
    if (!error) return children;

    return (
      <div
        className={
          standalone
            ? "grid h-full place-items-center bg-surface-950 p-8"
            : "grid h-full place-items-center p-8"
        }
      >
        <div className="max-w-md text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-danger/15 text-danger">
            <TriangleAlert className="size-5" />
          </span>
          <h1 className="mt-4 text-base font-semibold text-ink-100">
            {t("error.title")}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-500">
            {t("error.hint")}
          </p>
          {/* The message itself, because "something went wrong" is not
              reportable and this is the only place the user can read it. */}
          <p className="mt-3 break-words rounded-lg bg-surface-900 p-2 text-left font-mono text-2xs text-ink-500">
            {String(error.message || error)}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button onClick={() => window.location.reload()}>
              <RefreshCw className="size-3.5" /> {t("error.reload")}
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                const ok = await copyDiagnostics();
                this.setState({ copied: ok });
              }}
            >
              {this.state.copied ? t("common.copied") : t("error.copy")}
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

export const ErrorBoundary = withTranslation()(ErrorBoundaryInner);
