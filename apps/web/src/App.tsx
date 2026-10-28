import { Navigate, Route, Routes } from "react-router";
import { HomePage } from "./pages/HomePage";
import { PullsPage } from "./pages/PullsPage";
import { RepoPage } from "./pages/RepoPage";
import { ReviewPage } from "./pages/ReviewPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StatsPage } from "./pages/StatsPage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/pulls" element={<PullsPage />} />
      <Route path="/stats" element={<StatsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/reviews/:id" element={<ReviewPage />} />
      <Route path="/repos/:id" element={<RepoPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
