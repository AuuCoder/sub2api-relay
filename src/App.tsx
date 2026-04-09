import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { AdminLoginPage } from "./pages/AdminLoginPage";
import { CdkPage } from "./pages/CdkPage";
import { CdkHistoryPage } from "./pages/CdkHistoryPage";
import { CdkKeysPage } from "./pages/CdkKeysPage";
import { HomePage } from "./pages/HomePage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/muyu/login" element={<AdminLoginPage />} />
        <Route path="/muyu" element={<AdminDashboardPage />} />
        <Route path="/admin/login" element={<Navigate to="/muyu/login" replace />} />
        <Route path="/admin" element={<Navigate to="/muyu" replace />} />
        <Route path="/:cdk" element={<CdkPage />} />
        <Route path="/:cdk/keys" element={<CdkKeysPage />} />
        <Route path="/:cdk/history" element={<CdkHistoryPage />} />
      </Routes>
    </BrowserRouter>
  );
}
