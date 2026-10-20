import { ChakraProvider } from '@chakra-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../components/layout/ErrorBoundary';
import App from '../App';
import { authService } from '../services/authService';
import { getAdminStats } from '../services/adminApi';
import { listRoasts } from '../services/roastApi';
import theme from '../theme';
import { makeStats, makeUser } from './utils/fixtures';

vi.mock('../services/authService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/authService')>();
  return {
    ...actual,
    authService: {
      refresh: vi.fn(),
      me: vi.fn(),
      logout: vi.fn(),
    },
  };
});

vi.mock('../services/adminApi', () => ({ getAdminStats: vi.fn() }));
vi.mock('../services/roastApi', () => ({ listRoasts: vi.fn(), getRoastQuota: vi.fn() }));

const renderAt = (path: string) =>
  render(
    <ChakraProvider theme={theme}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </ChakraProvider>,
  );

describe('App routing', () => {
  beforeEach(() => {
    // Logged out: the silent refresh on app start fails with 401.
    vi.mocked(authService.refresh).mockRejectedValue(new Error('401'));
  });

  it('renders the 404 page for unknown routes', () => {
    renderAt('/does-not-exist');
    expect(screen.getByText(/This page does not exist/)).toBeInTheDocument();
  });

  it('redirects / to /login when logged out', async () => {
    renderAt('/');
    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
  });
});

describe('App routing (logged in)', () => {
  beforeEach(() => {
    vi.mocked(authService.refresh).mockResolvedValue({ access_token: 'tok', token_type: 'bearer' });
    vi.mocked(authService.logout).mockResolvedValue(undefined);
    vi.mocked(listRoasts).mockResolvedValue({ items: [], total: 0, page: 1, size: 5 });
    vi.mocked(getAdminStats).mockResolvedValue(makeStats());
  });

  it('redirects / to /roast/new and shows the header', async () => {
    vi.mocked(authService.me).mockResolvedValue(makeUser({ email: 'dev@example.com' }));
    renderAt('/');
    expect(await screen.findByRole('button', { name: /Roast Me/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Account menu for Dev Kumar/ })).toBeInTheDocument();
  });

  it('non-admin visiting /admin lands on /roast/new', async () => {
    vi.mocked(authService.me).mockResolvedValue(makeUser({ is_admin: false }));
    renderAt('/admin');
    expect(await screen.findByRole('button', { name: /Roast Me/ })).toBeInTheDocument();
    expect(getAdminStats).not.toHaveBeenCalled();
  });

  it('admin can open the lazy-loaded dashboard', async () => {
    vi.mocked(authService.me).mockResolvedValue(makeUser({ is_admin: true }));
    renderAt('/admin');
    expect(await screen.findByRole('heading', { name: 'Admin Dashboard' })).toBeInTheDocument();
    expect(await screen.findByText('1,234')).toBeInTheDocument();
  });

  it('logout from the account menu returns to /login', async () => {
    const user = userEvent.setup();
    vi.mocked(authService.me).mockResolvedValue(makeUser({ is_admin: true }));
    renderAt('/roast/new');
    await user.click(await screen.findByRole('button', { name: /Account menu for/ }));
    expect(await screen.findByRole('menuitem', { name: /Admin/ })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: /Logout/ }));
    await waitFor(() => expect(authService.logout).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
  });
});

function Boom(): JSX.Element {
  throw new Error('kaboom');
}

describe('ErrorBoundary', () => {
  it('renders a fallback when a child throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ChakraProvider theme={theme}>
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      </ChakraProvider>,
    );
    expect(screen.getByRole('heading', { name: /Oops, something went wrong/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    spy.mockRestore();
  });
});
