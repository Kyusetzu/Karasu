import type { ReactNode } from "react";
import { AnimatePresence, LazyMotion, MotionConfig, m } from "motion/react";
import { useTheme } from "@/stores/theme";

/** The feature set arrives in its own chunk, after the first paint, since nothing animates before then. */
const features = () => import("./motionFeatures").then((mod) => mod.default);

/** Motion for the whole app: lazy features, and reduced motion from the app's own switch as well as the system's. */
export function MotionProvider({ children }: { children: ReactNode }) {
  const reduce = useTheme((s) => s.reduceMotion);
  return (
    <LazyMotion features={features} strict>
      <MotionConfig reducedMotion={reduce ? "always" : "user"}>{children}</MotionConfig>
    </LazyMotion>
  );
}

/** AnimatePresence without `popLayout`, whose measuring `<style>` carries no nonce and is refused by the CSP. */
export function MotionPresence({
  mode = "sync",
  initial,
  children,
}: {
  mode?: "sync" | "wait";
  initial?: boolean;
  children: ReactNode;
}) {
  return (
    <AnimatePresence mode={mode} initial={initial}>
      {children}
    </AnimatePresence>
  );
}

export { m };
