import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { BuilderPage } from "./pages/BuilderPage";
import { GoLiveRequestsPage } from "./pages/GoLiveRequests";
import { PolicyEditorPage } from "./pages/PolicyEditor";
import { WorkflowTestPage } from "./pages/WorkflowTestPage";
import { WorkflowsRegistryPage } from "./pages/WorkflowsRegistry";
import { WorkflowRunsPage } from "./pages/WorkflowRuns";
import { RunDetailPage } from "./pages/RunDetail";

function AppShell() {
  const location = useLocation();
  const isBuilder = location.pathname.startsWith("/builder");
  /**
   * The platform screens use the full window.
   *
   * `.app-shell` caps content at 1180px, which suited the older single-column
   * pages but leaves a table of runs squeezed into the middle of a wide
   * monitor with empty gutters either side. These screens are dense and
   * horizontal; they get the whole width.
   */
  const isWide =
    location.pathname.startsWith("/workflows") ||
    location.pathname.startsWith("/runs");

  return (
    <div
      className={`app-shell${isBuilder ? " app-shell--builder" : ""}${
        isWide ? " app-shell--wide" : ""
      }`}
    >
      <header className="brand-bar">
        <p className="brand">
          Tekisho <span>Authoring</span>
        </p>
        <nav className="brand-nav">
          <Link to="/workflows">Workflows</Link>
          <Link to="/builder">Builder</Link>
          <Link to="/go-live-requests">Go-live</Link>
        </nav>
      </header>
      <Routes>
        {/* Screen 1 — the registry. The deck's step 1, and the home the rest
            of the flow is reached from. */}
        <Route path="/workflows" element={<WorkflowsRegistryPage />} />
        {/* Screen 12 — every run of one workflow. */}
        <Route path="/workflows/:graphKey/runs" element={<WorkflowRunsPage />} />
        {/* Screen 13 — one run and the path it took. */}
        <Route path="/runs/:runId" element={<RunDetailPage />} />
        <Route path="/builder" element={<BuilderPage />} />
        <Route path="/builder/:id" element={<BuilderPage />} />
        <Route path="/agents/:id" element={<PolicyEditorPage />} />
        {/* The registry is home. Opening the app lands on "what exists and how
            is it doing", not on a half-built editor. */}
        <Route path="/" element={<Navigate to="/workflows" replace />} />
        <Route path="/go-live-requests" element={<GoLiveRequestsPage />} />
        <Route path="/ops" element={<Navigate to="/workflows" replace />} />
        <Route path="/runs" element={<Navigate to="/workflows" replace />} />
        <Route path="/dev/workflow/:fixtureId" element={<WorkflowTestPage />} />
        <Route path="/dev/workflow" element={<WorkflowTestPage />} />
        <Route path="*" element={<Navigate to="/workflows" replace />} />
      </Routes>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
