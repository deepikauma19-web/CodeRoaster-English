import { useContext } from 'react';
import { AuthContext } from '../context/authContextObject';
import type { AuthContextValue } from '../types/auth';

/** Access the current auth state. Must be used inside <AuthProvider>. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export default useAuth;
