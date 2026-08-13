import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { AgentListPage } from "./pages/AgentList";
import { GoLiveRequestsPage } from "./pages/GoLiveRequests";
import { PolicyEditorPage } from "./pages/PolicyEditor";

export function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <header className="brand-bar">
          <p className="brand">
            Tekisho <span>Authoring</span>
          </p>
          <nav className="brand-nav">
            <Link to="/">Agents</Link>
            <Link to="/go-live-requests">Go-live requests</Link>
          </nav>
        </header>
        <Routes>
          <Route path="/" element={<AgentListPage />} />
          <Route path="/go-live-requests" element={<GoLiveRequestsPage />} />
          <Route path="/agents/:id" element={<PolicyEditorPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
