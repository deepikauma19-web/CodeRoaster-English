import api from './api';
import type { TokenResponse, User } from '../types';

const API_ROOT = `${import.meta.env.VITE_API_URL ?? ''}/api/v1`;

/** sessionStorage key holding the path to return to after login. */
export const POST_LOGIN_REDIRECT_KEY = 'roaster.postLoginRedirect';
export const DEFAULT_POST_LOGIN_PATH = '/roast/new';

export const getGoogleLoginUrl = (): string => `${API_ROOT}/auth/google/login`;

export const authService = {
  /** Exchange the httpOnly refresh cookie for a new access token. Rejects (401) when logged out. */
  async refresh(): Promise<TokenResponse> {
    const { data } = await api.post<TokenResponse>('/auth/refresh');
    return data;
  },

  async me(): Promise<User> {
    const { data } = await api.get<User>('/auth/me');
    return data;
  },

  async logout(): Promise<void> {
    await api.post('/auth/logout');
  },
};

/** Only allow same-origin, app-internal paths (blocks `//evil.com` style open redirects). */
const isSafeInternalPath = (path: string): boolean =>
  path.startsWith('/') &&
  !path.startsWith('//') &&
  !path.startsWith('/\\') &&
  !path.startsWith('/login') &&
  !path.startsWith('/auth/callback');

export const savePostLoginPath = (path: string): void => {
  if (!isSafeInternalPath(path)) return;
  try {
    window.sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, path);
  } catch {
    // sessionStorage unavailable (private mode / blocked) — fall back to the default path.
  }
};

/** Read and clear the saved post-login path. */
export const consumePostLoginPath = (): string => {
  try {
    const saved = window.sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY);
    window.sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
    if (saved && isSafeInternalPath(saved)) return saved;
  } catch {
    // Ignore storage errors.
  }
  return DEFAULT_POST_LOGIN_PATH;
};

export default authService;
