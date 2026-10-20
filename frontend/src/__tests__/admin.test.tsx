import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminLayout from '../components/layout/AdminLayout';
import AdminDashboardPage from '../pages/admin/AdminDashboardPage';
import AdminRoastsPage from '../pages/admin/AdminRoastsPage';
import AdminUsersPage from '../pages/admin/AdminUsersPage';
import {
  deleteAdminRoast,
  getAdminStats,
  listAdminRoasts,
  listAdminUsers,
  updateAdminUser,
} from '../services/adminApi';
import { authedValue, axiosError, makeAdminRoast, makeAdminUser, makeStats, makeUser } from './utils/fixtures';
import { renderWithProviders } from './utils/renderWithProviders';

vi.mock('../services/adminApi', () => ({
  getAdminStats: vi.fn(),
  listAdminUsers: vi.fn(),
  updateAdminUser: vi.fn(),
  listAdminRoasts: vi.fn(),
  deleteAdminRoast: vi.fn(),
}));

const mockStats = vi.mocked(getAdminStats);
const mockListUsers = vi.mocked(listAdminUsers);
const mockUpdateUser = vi.mocked(updateAdminUser);
const mockListRoasts = vi.mocked(listAdminRoasts);
const mockDeleteRoast = vi.mocked(deleteAdminRoast);

const admin = authedValue(makeUser({ id: 1, email: 'me@admin.com', is_admin: true }));

beforeEach(() => {
  for (const m of [mockStats, mockListUsers, mockUpdateUser, mockListRoasts, mockDeleteRoast]) m.mockReset();
});

describe('AdminDashboardPage', () => {
  it('renders stats', async () => {
    mockStats.mockResolvedValue(makeStats());
    renderWithProviders(<AdminDashboardPage />, { route: '/admin', auth: admin });
    expect(await screen.findByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('Total users')).toBeInTheDocument();
    expect(screen.getByText('56')).toBeInTheDocument();
    expect(screen.getByText('789')).toBeInTheDocument();
    expect(screen.getByText('72.4')).toBeInTheDocument();
    expect(screen.getByText('Decent')).toBeInTheDocument();
    expect(screen.getAllByText('5.0%').length).toBeGreaterThan(0);
    expect(screen.getByText('1.5M')).toBeInTheDocument();
    expect(screen.getByLabelText('Medium roasts')).toBeInTheDocument();
    expect(mockStats).toHaveBeenCalledTimes(1);
  });

  it('shows "no completed roasts" when avg_score is null', async () => {
    mockStats.mockResolvedValue(makeStats({ avg_score: null }));
    renderWithProviders(<AdminDashboardPage />, { route: '/admin', auth: admin });
    expect(await screen.findByText('No completed roasts yet')).toBeInTheDocument();
  });

  it('shows an error and retries', async () => {
    const user = userEvent.setup();
    mockStats.mockRejectedValueOnce(axiosError(500, { detail: 'stats broke' })).mockResolvedValueOnce(makeStats());
    renderWithProviders(<AdminDashboardPage />, { route: '/admin', auth: admin });
    expect(await screen.findByText('stats broke')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('1,234')).toBeInTheDocument();
    expect(mockStats).toHaveBeenCalledTimes(2);
  });
});

describe('AdminUsersPage', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const page = (items = [makeAdminUser()]) => ({ items, total: items.length, page: 1, size: 20 });

  it('debounces search and calls listAdminUsers with the search term once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockListUsers.mockResolvedValue(page());
    renderWithProviders(<AdminUsersPage />, { route: '/admin/users', auth: admin });
    await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(1));
    expect(mockListUsers.mock.calls[0][0]).toEqual({ search: undefined, page: 1, size: 20 });

    await user.type(screen.getByRole('textbox', { name: 'Search users' }), 'deep');
    // No request per keystroke.
    expect(mockListUsers).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(2));
    expect(mockListUsers.mock.calls[1][0]).toEqual({ search: 'deep', page: 1, size: 20 });
    expect(mockListUsers.mock.calls[1][1]).toBeInstanceOf(AbortSignal);
  });

  it('renders users and the empty state', async () => {
    mockListUsers.mockResolvedValueOnce(page([makeAdminUser({ email: 'x@y.z', full_name: 'Xavier', roast_count: 7, is_active: false })]));
    const { unmount } = renderWithProviders(<AdminUsersPage />, { route: '/admin/users', auth: admin });
    expect(await screen.findByText('Xavier')).toBeInTheDocument();
    expect(screen.getByText('x@y.z')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    unmount();
    mockListUsers.mockResolvedValueOnce(page([]));
    renderWithProviders(<AdminUsersPage />, { route: '/admin/users', auth: admin });
    expect(await screen.findByText(/No users found/)).toBeInTheDocument();
  });

  it('self-demotion 409 shows the backend detail', async () => {
    const user = userEvent.setup();
    mockListUsers.mockResolvedValue(page([makeAdminUser({ id: 1, email: 'me@admin.com', is_admin: true })]));
    mockUpdateUser.mockRejectedValue(axiosError(409, { detail: 'You cannot remove your own admin access' }));
    renderWithProviders(<AdminUsersPage />, { route: '/admin/users', auth: admin });
    await user.click(await screen.findByRole('checkbox', { name: 'Remove admin from me@admin.com' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Remove admin?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Remove admin' }));
    expect(mockUpdateUser).toHaveBeenCalledWith(1, { is_admin: false });
    expect(await screen.findByText('You cannot remove your own admin access')).toBeInTheDocument();
    expect(screen.getByText('Not allowed')).toBeInTheDocument();
    // Switch stays on.
    expect(screen.getByRole('checkbox', { name: 'Remove admin from me@admin.com' })).toBeChecked();
  });

  it('deactivating a user updates the row after confirmation', async () => {
    const user = userEvent.setup();
    const target = makeAdminUser({ id: 5, email: 'bad@actor.com', is_active: true });
    mockListUsers.mockResolvedValue(page([target]));
    mockUpdateUser.mockResolvedValue({ ...target, is_active: false });
    renderWithProviders(<AdminUsersPage />, { route: '/admin/users', auth: admin });
    await user.click(await screen.findByRole('checkbox', { name: 'Deactivate bad@actor.com' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    expect(mockUpdateUser).toHaveBeenCalledWith(5, { is_active: false });
    expect(await screen.findByRole('checkbox', { name: 'Activate bad@actor.com' })).not.toBeChecked();
    expect(screen.getByText('User updated')).toBeInTheDocument();
  });

  it('cancel closes the dialog without updating', async () => {
    const user = userEvent.setup();
    mockListUsers.mockResolvedValue(page([makeAdminUser({ id: 5, email: 'u@x.com', is_admin: false })]));
    renderWithProviders(<AdminUsersPage />, { route: '/admin/users', auth: admin });
    await user.click(await screen.findByRole('checkbox', { name: 'Make admin u@x.com' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Grant admin?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('pagination requests the next page', async () => {
    const user = userEvent.setup();
    mockListUsers.mockResolvedValue({ items: [makeAdminUser()], total: 45, page: 1, size: 20 });
    renderWithProviders(<AdminUsersPage />, { route: '/admin/users', auth: admin });
    await user.click(await screen.findByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(mockListUsers).toHaveBeenLastCalledWith({ search: undefined, page: 2, size: 20 }, expect.any(AbortSignal)));
  });

  it('shows list errors with retry', async () => {
    mockListUsers.mockRejectedValue(axiosError(500, { detail: 'users broke' }));
    renderWithProviders(<AdminUsersPage />, { route: '/admin/users', auth: admin });
    expect(await screen.findByText('users broke')).toBeInTheDocument();
  });
});

describe('AdminRoastsPage', () => {
  const roastsPage = (items = [makeAdminRoast()]) => ({ items, total: items.length, page: 1, size: 20 });

  it('lists roasts, filters by status, and deletes after confirmation', async () => {
    const user = userEvent.setup();
    mockListRoasts.mockResolvedValue(roastsPage([makeAdminRoast({ id: 11, user_email: 'stu@dent.com' })]));
    mockDeleteRoast.mockResolvedValue(undefined);
    renderWithProviders(<AdminRoastsPage />, { route: '/admin/roasts', auth: admin });
    expect(await screen.findByText('stu@dent.com')).toBeInTheDocument();
    expect(mockListRoasts).toHaveBeenCalledWith(
      { status: undefined, from: undefined, to: undefined, page: 1, size: 20 },
      expect.any(AbortSignal),
    );

    await user.selectOptions(screen.getByRole('combobox'), 'failed');
    await waitFor(() =>
      expect(mockListRoasts).toHaveBeenLastCalledWith(
        { status: 'failed', from: undefined, to: undefined, page: 1, size: 20 },
        expect.any(AbortSignal),
      ),
    );

    await user.click(await screen.findByRole('button', { name: 'Delete roast of octo/todo-app' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('stu@dent.com');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mockDeleteRoast).toHaveBeenCalledWith(11));
    expect(await screen.findByText('Roast deleted')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() =>
      expect(mockListRoasts).toHaveBeenLastCalledWith(
        { status: undefined, from: undefined, to: undefined, page: 1, size: 20 },
        expect.any(AbortSignal),
      ),
    );
  });

  it('opens the details drawer for a non-public roast', async () => {
    const user = userEvent.setup();
    mockListRoasts.mockResolvedValue(roastsPage([makeAdminRoast({ summary: 'Mid code', is_public: false })]));
    renderWithProviders(<AdminRoastsPage />, { route: '/admin/roasts', auth: admin });
    await user.click(await screen.findByRole('button', { name: 'View roast of octo/todo-app' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Mid code')).toBeInTheDocument();
    expect(within(drawer).getByText('Decent')).toBeInTheDocument();
  });

  it('opens the public share page in a new tab for public roasts', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    mockListRoasts.mockResolvedValue(roastsPage([makeAdminRoast({ is_public: true, share_slug: 'pub1' })]));
    renderWithProviders(<AdminRoastsPage />, { route: '/admin/roasts', auth: admin });
    await user.click(await screen.findByRole('button', { name: 'View roast of octo/todo-app' }));
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/\/r\/pub1$/), '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('delete failure shows an error toast', async () => {
    const user = userEvent.setup();
    mockListRoasts.mockResolvedValue(roastsPage());
    mockDeleteRoast.mockRejectedValue(axiosError(500, { detail: 'cannot delete' }));
    renderWithProviders(<AdminRoastsPage />, { route: '/admin/roasts', auth: admin });
    await user.click(await screen.findByRole('button', { name: 'Delete roast of octo/todo-app' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('cannot delete')).toBeInTheDocument();
  });

  it('invalid date range warns and skips fetching', async () => {
    const user = userEvent.setup();
    mockListRoasts.mockResolvedValue(roastsPage([]));
    const { container } = renderWithProviders(<AdminRoastsPage />, { route: '/admin/roasts', auth: admin });
    expect(await screen.findByText(/No roasts/i)).toBeInTheDocument();
    const [from, to] = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="date"]'));
    await user.type(to, '2026-01-01');
    const calls = mockListRoasts.mock.calls.length;
    await user.type(from, '2026-02-01');
    expect(await screen.findByText(/The "From" date must be before the "To" date/)).toBeInTheDocument();
    expect(mockListRoasts.mock.calls.length).toBe(calls);
  });
});

describe('AdminLayout', () => {
  it('renders admin navigation', () => {
    renderWithProviders(<AdminLayout />, { route: '/admin', auth: admin });
    const nav = screen.getByRole('navigation', { name: 'Admin navigation' });
    expect(within(nav).getByRole('link', { name: /Users/ })).toHaveAttribute('href', '/admin/users');
    expect(within(nav).getByRole('link', { name: /Roasts/ })).toHaveAttribute('href', '/admin/roasts');
  });
});
