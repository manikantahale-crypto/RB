import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { App } from "./App";
// tokens first — styles.css and every component read from it.
import "./tokens.css";
import "./styles.css";
// Per-screen styles, one file each (see ref/Orchestrator_Screen_Development_Guide.md).
import "./styles/editor.css";

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
