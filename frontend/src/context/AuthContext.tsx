import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { setAccessToken, setOnAuthFailure } from '../services/api';
import { authService, getGoogleLoginUrl } from '../services/authService';
import type { User } from '../types';
import type { AuthContextValue, AuthStatus } from '../types/auth';
import { AuthContext } from './authContextObject';

interface AuthProviderProps {
  children: ReactNode;
}

/** True when the current URL is the OAuth callback carrying a fresh token (AuthCallbackPage handles it). */
const isOAuthCallbackWithToken = (): boolean =>
  typeof window !== 'undefined' &&
  window.location.pathname === '/auth/callback' &&
  window.location.hash.includes('access_token=');

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  // Guards against React StrictMode running the bootstrap effect twice
  // (two refresh calls would race on refresh-token rotation).
  const bootstrappedRef = useRef(false);
  // Incremented on every explicit login/logout so stale async results are ignored.
  const sessionVersionRef = useRef(0);

  const setLoggedOut = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  // Silent session restore on app start.
  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;

    if (isOAuthCallbackWithToken()) {
      // AuthCallbackPage will call completeLogin(); stay in 'loading' until then.
      return;
    }

    const version = sessionVersionRef.current;
    const restore = async (): Promise<void> => {
      try {
        const { access_token } = await authService.refresh();
        if (version !== sessionVersionRef.current) return;
        setAccessToken(access_token);
        const me = await authService.me();
        if (version !== sessionVersionRef.current) return;
        setUser(me);
        setStatus('authenticated');
      } catch {
        // Not logged in (401) or network error — treat as logged out.
        if (version !== sessionVersionRef.current) return;
        setLoggedOut();
      }
    };
    void restore();
  }, [setLoggedOut]);

  // When the api interceptor's refresh fails, drop to logged-out state.
  useEffect(() => {
    setOnAuthFailure(() => {
      sessionVersionRef.current += 1;
      setLoggedOut();
    });
    return () => setOnAuthFailure(null);
  }, [setLoggedOut]);

  const loginWithGoogle = useCallback(() => {
    window.location.assign(getGoogleLoginUrl());
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    sessionVersionRef.current += 1;
    try {
      await authService.logout();
    } catch {
      // Best effort: the server session may already be gone. Clear local state regardless.
    } finally {
      setLoggedOut();
    }
  }, [setLoggedOut]);

  const completeLogin = useCallback(
    async (accessToken: string): Promise<User> => {
      sessionVersionRef.current += 1;
      const version = sessionVersionRef.current;
      setAccessToken(accessToken);
      try {
        const me = await authService.me();
        if (version === sessionVersionRef.current) {
          setUser(me);
          setStatus('authenticated');
        }
        return me;
      } catch (err: unknown) {
        if (version === sessionVersionRef.current) setLoggedOut();
        throw err;
      }
    },
    [setLoggedOut],
  );

  const refreshUser = useCallback(async (): Promise<User | null> => {
    try {
      const me = await authService.me();
      setUser(me);
      setStatus('authenticated');
      return me;
    } catch {
      return null;
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      isAuthenticated: status === 'authenticated' && user !== null,
      isAdmin: Boolean(user?.is_admin),
      loginWithGoogle,
      logout,
      completeLogin,
      refreshUser,
    }),
    [user, status, loginWithGoogle, logout, completeLogin, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export default AuthProvider;
