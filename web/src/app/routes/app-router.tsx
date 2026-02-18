import { Navigate, Route, Routes } from 'react-router-dom';

import { DashboardPage } from '@/pages/dashboard/dashboard-page';
import { SettingsPage } from '@/pages/settings/settings-page';
import { DashboardLayout } from '@/shared/layouts/dashboard-layout';

export function AppRouter() {
  return (
    <Routes>
      <Route element={<DashboardLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
