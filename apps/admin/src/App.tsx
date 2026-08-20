import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { BuilderPage } from "./pages/BuilderPage";
import { GoLiveRequestsPage } from "./pages/GoLiveRequests";
import { PolicyEditorPage } from "./pages/PolicyEditor";
import { WorkflowTestPage } from "./pages/WorkflowTestPage";

function AppShell() {
  const location = useLocation();
  const isBuilder = location.pathname.startsWith("/builder");

  return (
    <div className={`app-shell${isBuilder ? " app-shell--builder" : ""}`}>
      <header className="brand-bar">
        <p className="brand">
          Tekisho <span>Authoring</span>
        </p>
        <nav className="brand-nav">
          <Link to="/builder">Builder</Link>
          <Link to="/go-live-requests">Go-live</Link>
        </nav>
      </header>
      <Routes>
        <Route path="/builder" element={<BuilderPage />} />
        <Route path="/builder/:id" element={<BuilderPage />} />
        <Route path="/agents/:id" element={<PolicyEditorPage />} />
        <Route path="/" element={<Navigate to="/builder" replace />} />
        <Route path="/go-live-requests" element={<GoLiveRequestsPage />} />
        <Route path="/ops" element={<Navigate to="/builder" replace />} />
        <Route path="/runs" element={<Navigate to="/builder" replace />} />
        <Route path="/dev/workflow/:fixtureId" element={<WorkflowTestPage />} />
        <Route path="/dev/workflow" element={<WorkflowTestPage />} />
        <Route path="*" element={<Navigate to="/builder" replace />} />
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
