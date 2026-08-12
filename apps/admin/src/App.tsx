import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AgentListPage } from "./pages/AgentList";
import { PolicyEditorPage } from "./pages/PolicyEditor";

export function App() {
  return (
    <BrowserRouter>
      <div className="app-shell">
        <header className="brand-bar">
          <p className="brand">
            Tekisho <span>Authoring</span>
          </p>
          <p className="brand-meta">Generate · Compile · Publish</p>
        </header>
        <Routes>
          <Route path="/" element={<AgentListPage />} />
          <Route path="/agents/:id" element={<PolicyEditorPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
