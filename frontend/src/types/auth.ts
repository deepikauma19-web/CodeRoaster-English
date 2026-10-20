import type { User } from './user';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

/** Error codes the backend puts in `/auth/callback#error=<code>`. */
export type OAuthErrorCode = 'invalid_state' | 'oauth_failed' | 'account_deactivated';

export interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  isAuthenticated: boolean;
  isAdmin: boolean;
  /** Full-page redirect to the backend Google OAuth login endpoint. */
  loginWithGoogle: () => void;
  /** Revoke the refresh cookie (best effort) and clear local auth state. Never throws. */
  logout: () => Promise<void>;
  /** Store an access token from the OAuth callback and load the user. Throws if /auth/me fails. */
  completeLogin: (accessToken: string) => Promise<User>;
  /** Re-fetch /auth/me (e.g. after profile changes). Returns null on failure. */
  refreshUser: () => Promise<User | null>;
}
