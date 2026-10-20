import { ChakraProvider } from '@chakra-ui/react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminRoute } from '../components/auth/AdminRoute';
import { ProtectedRoute } from '../components/auth/ProtectedRoute';
import { AuthContext } from '../context/authContextObject';
import { AuthProvider } from '../context/AuthContext';
import { useAuth } from '../hooks/useAuth';
import AuthCallbackPage from '../pages/AuthCallbackPage';
import HomeRedirect from '../pages/HomeRedirect';
import LoginPage from '../pages/LoginPage';
import ProfilePage from '../pages/ProfilePage';
import { getAccessToken, setAccessToken } from '../services/api';
import { authService, POST_LOGIN_REDIRECT_KEY } from '../services/authService';
import theme from '../theme';
import type { AuthContextValue } from '../types/auth';
import { authedValue, makeAuthValue, makeUser } from './utils/fixtures';
import { LocationProbe } from './utils/LocationProbe';

vi.mock('../services/authService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/authService')>();
  return {
    ...actual,
    authService: { refresh: vi.fn(), me: vi.fn(), logout: vi.fn() },
  };
});

const mockRefresh = vi.mocked(authService.refresh);
const mockMe = vi.mocked(authService.me);
const mockLogout = vi.mocked(authService.logout);

const renderGuarded = (auth: AuthContextValue, path: string) =>
  render(
    <ChakraProvider theme={theme}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/login" element={<div>login page</div>} />
            <Route path="/roast/new" element={<div>new roast page</div>} />
            <Route element={<ProtectedRoute />}>
              <Route path="/roasts/:id" element={<div>roast result</div>} />
              <Route element={<AdminRoute />}>
                <Route path="/admin" element={<div>admin area</div>} />
              </Route>
            </Route>
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </AuthContext.Provider>
    </ChakraProvider>,
  );

describe('ProtectedRoute / AdminRoute', () => {
  afterEach(() => window.sessionStorage.clear());

  it('unauthenticated → /login and remembers the requested path', () => {
    renderGuarded(makeAuthValue(), '/roasts/7?x=1');
    expect(screen.getByText('login page')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
    expect(window.sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY)).toBe('/roasts/7?x=1');
  });

  it('shows a spinner while auth is loading', () => {
    renderGuarded(makeAuthValue({ status: 'loading' }), '/roasts/7');
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session…');
  });

  it('authenticated user sees protected content', () => {
    renderGuarded(authedValue(), '/roasts/7');
    expect(screen.getByText('roast result')).toBeInTheDocument();
  });

  it('unauthenticated on admin route → /login', () => {
    renderGuarded(makeAuthValue(), '/admin');
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
  });

  it('non-admin → /roast/new', () => {
    renderGuarded(authedValue(makeUser({ is_admin: false })), '/admin');
    expect(screen.getByText('new roast page')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/roast/new');
  });

  it('admin sees admin content', () => {
    renderGuarded(authedValue(makeUser({ is_admin: true })), '/admin');
    expect(screen.getByText('admin area')).toBeInTheDocument();
  });

  it('AdminRoute alone handles loading and unauthenticated', () => {
    const renderAdmin = (auth: AuthContextValue) =>
      render(
        <ChakraProvider theme={theme}>
          <AuthContext.Provider value={auth}>
            <MemoryRouter initialEntries={['/admin']}>
              <Routes>
                <Route path="/login" element={<div>login page</div>} />
                <Route element={<AdminRoute />}>
                  <Route path="/admin" element={<div>admin area</div>} />
                </Route>
              </Routes>
            </MemoryRouter>
          </AuthContext.Provider>
        </ChakraProvider>,
      );
    const { unmount } = renderAdmin(makeAuthValue({ status: 'loading' }));
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session…');
    unmount();
    renderAdmin(makeAuthValue());
    expect(screen.getByText('login page')).toBeInTheDocument();
  });
});

const renderCallback = (auth: AuthContextValue) =>
  render(
    <ChakraProvider theme={theme}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={['/auth/callback']}>
          <Routes>
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="*" element={<div>elsewhere</div>} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </AuthContext.Provider>
    </ChakraProvider>,
  );

describe('AuthCallbackPage', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
    window.sessionStorage.clear();
  });

  it('completes login with #access_token, clears the hash and navigates to the saved path', async () => {
    window.history.replaceState(null, '', '/auth/callback#access_token=tok123&token_type=bearer');
    window.sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, '/roasts/9');
    const completeLogin = vi.fn().mockResolvedValue(makeUser());
    renderCallback(makeAuthValue({ status: 'loading', completeLogin }));
    expect(screen.getByRole('status')).toHaveTextContent(/Signing you in/);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/roasts/9'));
    expect(completeLogin).toHaveBeenCalledTimes(1);
    expect(completeLogin).toHaveBeenCalledWith('tok123');
    expect(window.location.hash).toBe('');
  });

  it('defaults to /roast/new when nothing was saved', async () => {
    window.history.replaceState(null, '', '/auth/callback#access_token=abc');
    const completeLogin = vi.fn().mockResolvedValue(makeUser());
    renderCallback(makeAuthValue({ status: 'loading', completeLogin }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/roast/new'));
  });

  it('#error=account_deactivated shows the deactivated message without a retry button', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/auth/callback#error=account_deactivated');
    const completeLogin = vi.fn();
    renderCallback(makeAuthValue({ completeLogin }));
    expect(screen.getByRole('heading', { name: /Account deactivated/ })).toBeInTheDocument();
    expect(screen.getByText('Error code: account_deactivated')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(completeLogin).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Back to login' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
  });

  it.each([
    ['#error=invalid_state', /Session timed out/],
    ['#error=something_weird', /Something went wrong/],
    ['', /Login details missing/],
  ])('hash %j shows an error with Try again', async (hash, title) => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', `/auth/callback${hash}`);
    const loginWithGoogle = vi.fn();
    renderCallback(makeAuthValue({ loginWithGoogle }));
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(loginWithGoogle).toHaveBeenCalled();
  });

  it('shows oauth_failed when completeLogin rejects', async () => {
    window.history.replaceState(null, '', '/auth/callback#access_token=bad');
    const completeLogin = vi.fn().mockRejectedValue(new Error('401'));
    renderCallback(makeAuthValue({ status: 'loading', completeLogin }));
    expect(await screen.findByRole('heading', { name: /Could not reach Google/ })).toBeInTheDocument();
  });
});

function AuthProbe() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="user">{auth.user?.email ?? 'none'}</span>
      <span data-testid="admin">{String(auth.isAdmin)}</span>
      <button type="button" onClick={() => void auth.logout()}>
        logout
      </button>
      <button type="button" onClick={() => void auth.completeLogin('fresh').catch(() => undefined)}>
        complete
      </button>
      <button type="button" onClick={() => void auth.refreshUser()}>
        refresh-user
      </button>
      <button type="button" onClick={() => auth.loginWithGoogle()}>
        google
      </button>
    </div>
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    mockRefresh.mockReset();
    mockMe.mockReset();
    mockLogout.mockReset();
    setAccessToken(null);
  });

  const renderProvider = () => render(<AuthProvider><AuthProbe /></AuthProvider>);

  it('restores the session silently on start', async () => {
    mockRefresh.mockResolvedValue({ access_token: 'restored', token_type: 'bearer' });
    mockMe.mockResolvedValue(makeUser({ email: 'a@b.c', is_admin: true }));
    renderProvider();
    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('user')).toHaveTextContent('a@b.c');
    expect(screen.getByTestId('admin')).toHaveTextContent('true');
    expect(getAccessToken()).toBe('restored');
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('becomes unauthenticated when refresh fails', async () => {
    mockRefresh.mockRejectedValue(new Error('401'));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
    expect(mockMe).not.toHaveBeenCalled();
  });

  it('logout clears state even if the server call fails', async () => {
    const user = userEvent.setup();
    mockRefresh.mockResolvedValue({ access_token: 't', token_type: 'bearer' });
    mockMe.mockResolvedValue(makeUser());
    mockLogout.mockRejectedValue(new Error('network'));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    await user.click(screen.getByRole('button', { name: 'logout' }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
    expect(getAccessToken()).toBeNull();
  });

  it('completeLogin stores the token and loads the user; failure logs out', async () => {
    const user = userEvent.setup();
    mockRefresh.mockRejectedValue(new Error('401'));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
    mockMe.mockResolvedValueOnce(makeUser({ email: 'new@x.y' }));
    await user.click(screen.getByRole('button', { name: 'complete' }));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('new@x.y'));
    expect(getAccessToken()).toBe('fresh');

    mockMe.mockRejectedValueOnce(new Error('401'));
    await user.click(screen.getByRole('button', { name: 'complete' }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
  });

  it('refreshUser updates the user; loginWithGoogle redirects', async () => {
    const user = userEvent.setup();
    mockRefresh.mockRejectedValue(new Error('401'));
    const assign = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, pathname: '/', hash: '', assign },
    });
    try {
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
      mockMe.mockResolvedValueOnce(makeUser({ email: 'r@x.y' }));
      await user.click(screen.getByRole('button', { name: 'refresh-user' }));
      await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('r@x.y'));
      await user.click(screen.getByRole('button', { name: 'google' }));
      expect(assign).toHaveBeenCalledWith(expect.stringMatching(/\/api\/v1\/auth\/google\/login$/));
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    }
  });

  it('useAuth throws outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<AuthProbe />)).toThrow(/useAuth must be used within an AuthProvider/);
    spy.mockRestore();
  });

  it('skips the silent refresh on the OAuth callback with a token', async () => {
    window.history.replaceState(null, '', '/auth/callback#access_token=x');
    try {
      renderProvider();
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockRefresh).not.toHaveBeenCalled();
      expect(screen.getByTestId('status')).toHaveTextContent('loading');
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });
});

const renderPage = (ui: ReactElement, auth: AuthContextValue, path = '/x') =>
  render(
    <ChakraProvider theme={theme}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={path} element={ui} />
            <Route path="*" element={<div>elsewhere</div>} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </AuthContext.Provider>
    </ChakraProvider>,
  );

describe('auth pages', () => {
  it('HomeRedirect sends logged-in users to /roast/new and others to /login', () => {
    const { unmount } = renderPage(<HomeRedirect />, authedValue(), '/');
    expect(screen.getByTestId('location')).toHaveTextContent('/roast/new');
    unmount();
    renderPage(<HomeRedirect />, makeAuthValue(), '/');
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
  });

  it('LoginPage shows Google sign-in and redirects when authenticated', async () => {
    const user = userEvent.setup();
    const loginWithGoogle = vi.fn();
    const { unmount } = renderPage(<LoginPage />, makeAuthValue({ loginWithGoogle }), '/login');
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(loginWithGoogle).toHaveBeenCalled();
    unmount();
    renderPage(<LoginPage />, authedValue(), '/login');
    expect(screen.getByTestId('location')).toHaveTextContent('/roast/new');
  });

  it('ProfilePage shows the user and logs out', async () => {
    const user = userEvent.setup();
    const logout = vi.fn().mockResolvedValue(undefined);
    renderPage(
      <ProfilePage />,
      { ...authedValue(makeUser({ full_name: 'Deepa R', is_admin: true })), logout },
      '/profile',
    );
    expect(screen.getByRole('heading', { name: 'Deepa R' })).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Logout' }));
    expect(logout).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'));
  });
});
