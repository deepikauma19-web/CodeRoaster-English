import { Center, Spinner } from '@chakra-ui/react';
import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AdminRoute } from './components/auth/AdminRoute';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { AppLayout } from './components/layout/AppLayout';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { AuthProvider } from './context/AuthContext';
import AuthCallbackPage from './pages/AuthCallbackPage';
import HomeRedirect from './pages/HomeRedirect';
import LoginPage from './pages/LoginPage';
import NewRoastPage from './pages/NewRoastPage';
import NotFoundPage from './pages/NotFoundPage';
import ProfilePage from './pages/ProfilePage';
import PublicRoastPage from './pages/PublicRoastPage';
import RoastResultPage from './pages/RoastResultPage';

const AdminLayout = lazy(() => import('./components/layout/AdminLayout'));
const AdminDashboardPage = lazy(() => import('./pages/admin/AdminDashboardPage'));
const AdminUsersPage = lazy(() => import('./pages/admin/AdminUsersPage'));
const AdminRoastsPage = lazy(() => import('./pages/admin/AdminRoastsPage'));
const AdminReportsPage = lazy(() => import('./pages/admin/AdminReportsPage'));

function PageFallback() {
  return (
    <Center py={20}>
      <Spinner size="xl" color="ink.500" thickness="4px" />
    </Center>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route element={<AppLayout />}>
              <Route index element={<HomeRedirect />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/r/:shareSlug" element={<PublicRoastPage />} />

              <Route element={<ProtectedRoute />}>
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/roast/new" element={<NewRoastPage />} />
                <Route path="/roasts/:id" element={<RoastResultPage />} />

                <Route element={<AdminRoute />}>
                  <Route path="/admin" element={<AdminLayout />}>
                    <Route index element={<AdminDashboardPage />} />
                    <Route path="users" element={<AdminUsersPage />} />
                    <Route path="roasts" element={<AdminRoastsPage />} />
                    <Route path="reports" element={<AdminReportsPage />} />
                  </Route>
                </Route>
              </Route>

              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
    </ErrorBoundary>
  );
}
