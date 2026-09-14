import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { App } from "./App";
// tokens first — styles.css and every component read from it.
import "./tokens.css";
import "./styles.css";
/**
 * Per-screen styles, one file each, imported in screen order.
 *
 * The order is the cascade, so it is deliberate rather than alphabetical: a
 * later file may lean on an earlier one, and shuffling these can restyle a
 * screen nobody touched. Add a new screen's file at the end.
 *
 * `npm run check:styles -w @tekisho/admin` enforces that each file only
 * contains its own screen's classes.
 */
import "./styles/new-workflow.css";
import "./styles/event-catalog.css";
import "./styles/graph-editor.css";
import "./styles/live-test.css";
import "./styles/raise-request.css";
import "./styles/release.css";
import "./styles/platform-health.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root missing");
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
