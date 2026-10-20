import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { AuthSpinner } from './AuthSpinner';

/** Requires an admin. Must be nested inside <ProtectedRoute>; non-admins go to /roast/new. */
export function AdminRoute() {
  const { status, isAdmin } = useAuth();

  if (status === 'loading') {
    return <AuthSpinner />;
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/roast/new" replace />;
  }

  return <Outlet />;
}

export default AdminRoute;
