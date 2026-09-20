import { scan } from "react-scan";

/** Injected by vite.config.ts as the first module script when `KARASU_SCAN` is set; never imported, never bundled. */
scan({ enabled: true });
