import { Navigate } from 'react-router-dom';
import { AuthSpinner } from '../components/auth/AuthSpinner';
import { useAuth } from '../hooks/useAuth';

/** `/` → /roast/new when logged in, otherwise /login. */
export default function HomeRedirect() {
  const { status } = useAuth();
  if (status === 'loading') return <AuthSpinner />;
  return <Navigate to={status === 'authenticated' ? '/roast/new' : '/login'} replace />;
}
