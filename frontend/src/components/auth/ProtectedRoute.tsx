import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { savePostLoginPath } from '../../services/authService';
import { AuthSpinner } from './AuthSpinner';

/** Requires a logged-in user. Saves the requested path so login can return to it. */
export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <AuthSpinner />;
  }

  if (status === 'unauthenticated') {
    savePostLoginPath(`${location.pathname}${location.search}${location.hash}`);
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

export default ProtectedRoute;
