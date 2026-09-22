/**
 * The authoring platform's shell and routes.
 *
 * BUILDER IS GONE FROM HERE, AND ITS TABLES ARE NOT.
 *
 * `/builder`, `/builder/:id` and `/agents/:id` served the trial-era model where
 * an agent owned a workflow. The unit of authorship is a workflow now, and the
 * guide is explicit that the word is being retired from the UI. Three facts
 * decided it rather than taste: nine active workflows have no agent at all and
 * run fine, no step has ever been skipped by an agent policy decision (zero,
 * across 1,522 recorded steps), and 424 of the 433 agents in the database are
 * test fixtures.
 *
 * What was removed is SCREENS. `builder.*` still holds every row it did, and
 * the orchestrator still reads `builder.agent_definitions` before each node to
 * decide whether an actor may act unattended — see
 * packages/orchestrator/src/policy/engine.ts. Deleting a page must not change
 * what runs, and this one does not.
 *
 * The old paths redirect rather than 404. Somebody with `/builder` bookmarked
 * should land somewhere useful, not on a blank page that looks like an outage.
 */
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { SignIn } from "./components/SignIn.js";
import { MeProvider, useMe } from "./lib/me.js";
import { GoLiveRequestsPage } from "./pages/GoLiveRequests";
import { RaiseRequestPage } from "./pages/RaiseRequest";
import { ReleaseConsolePage } from "./pages/ReleaseConsole";
import { PlatformHealthPage } from "./pages/PlatformHealth";
import { WorkflowTestPage } from "./pages/WorkflowTestPage";
import { WorkflowsRegistryPage } from "./pages/WorkflowsRegistry";
import { WorkflowRunsPage } from "./pages/WorkflowRuns";
import { RunDetailPage } from "./pages/RunDetail";
import { LiveTestPage } from "./pages/LiveTest";
import { GraphEditorPage } from "./pages/GraphEditor";
import { NewWorkflowPage } from "./pages/NewWorkflow";

function AppShell() {
  const location = useLocation();
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
    <div className={`app-shell${isWide ? " app-shell--wide" : ""}`}>
      <header className="brand-bar">
        <p className="brand">
          Tekisho <span>Authoring</span>
        </p>
        <nav className="brand-nav">
          <Link to="/workflows">Workflows</Link>
          <Link to="/go-live-requests">Go-live</Link>
          {/* Was reachable only by typing the URL, which is no way to find the
              one screen that reports faults nothing else does. */}
          <Link to="/platform/health">Health</Link>
        </nav>
        <RoleBadge />
        <SignIn />
      </header>
      <Routes>
        {/* Screen 1 — the registry. The deck's step 1, and the home the rest
            of the flow is reached from. */}
        <Route path="/workflows" element={<WorkflowsRegistryPage />} />
        {/* Screen 12 — every run of one workflow. */}
        <Route path="/workflows/:graphKey/runs" element={<WorkflowRunsPage />} />
        {/* Screen 13 — one run and the path it took. */}
        <Route path="/runs/:runId" element={<RunDetailPage />} />
        <Route path="/workflows/:graphKey/test" element={<LiveTestPage />} />
        {/* Screen 6 — raise an approval request. Not a GitHub PR: see §6 of
            Orchestrator_Decisions.md for why that was cancelled. */}
        <Route path="/workflows/:graphKey/request" element={<RaiseRequestPage />} />
        {/* Screen 4 — the graph editor. */}
        {/* Screen 2 — describe or clone, then one proposal. */}
        <Route path="/workflows/new" element={<NewWorkflowPage />} />
        <Route path="/workflows/:graphKey/edit" element={<GraphEditorPage />} />
        {/* The registry is home. Opening the app lands on "what exists and how
            is it doing", not on a half-built editor. */}
        <Route path="/" element={<Navigate to="/workflows" replace />} />
        {/* Screen 10 — what is waiting for a second person to approve. */}
        <Route path="/go-live-requests" element={<GoLiveRequestsPage />} />
        {/* Screen 10 — one version, and what approving it does. */}
        <Route
          path="/go-live-requests/:graphKey"
          element={<ReleaseConsolePage />}
        />
        {/* The faults nothing else reports: work nobody collects, steps in no
            registry, events nothing answers. */}
        <Route path="/platform/health" element={<PlatformHealthPage />} />
        {/* Retired — see the note at the top of this file. */}
        <Route path="/builder" element={<Navigate to="/workflows" replace />} />
        <Route path="/builder/:id" element={<Navigate to="/workflows" replace />} />
        <Route path="/agents/:id" element={<Navigate to="/workflows" replace />} />
        <Route path="/ops" element={<Navigate to="/workflows" replace />} />
        <Route path="/runs" element={<Navigate to="/workflows" replace />} />
        <Route path="/dev/workflow/:fixtureId" element={<WorkflowTestPage />} />
        <Route path="/dev/workflow" element={<WorkflowTestPage />} />
        <Route path="*" element={<Navigate to="/workflows" replace />} />
      </Routes>
    </div>
  );
}

/**
 * Which of the two you are, said once, where you can see it.
 *
 * Without this an operator meets the rule as a refusal — a button that is not
 * there, or a sentence after pressing one. Saying it up front turns "why can
 * I not do this" into something already answered.
 */
function RoleBadge() {
  const { me, loading } = useMe();
  if (loading || !me) return null;
  return (
    <span
      className={`role-badge role-badge--${me.role}`}
      title={
        me.role === "admin"
          ? `You can release: ${me.adminOnly.join(", ")}.`
          : `You can author, edit and test anything. An admin does the rest: ${me.adminOnly.join(", ")}.`
      }
    >
      {me.role}
    </span>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <MeProvider>
        <AppShell />
      </MeProvider>
    </BrowserRouter>
  );
}
