import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminReportsPage from '../pages/admin/AdminReportsPage';
import { listAdminReports, setAdminRoastSharingBlocked } from '../services/adminApi';
import type { AdminReport } from '../types';
import { authedValue, makeAdminRoast, makeUser } from './utils/fixtures';
import { renderWithProviders } from './utils/renderWithProviders';

vi.mock('../services/adminApi', () => ({
  listAdminReports: vi.fn(),
  setAdminRoastSharingBlocked: vi.fn(),
}));

const mockList = vi.mocked(listAdminReports);
const mockBlock = vi.mocked(setAdminRoastSharingBlocked);
const admin = authedValue(makeUser({ id: 1, email: 'me@admin.com', is_admin: true }));

const makeReport = (overrides: Partial<AdminReport> = {}): AdminReport => ({
  id: 1,
  roast_id: 7,
  repo_owner: 'octo',
  repo_name: 'todo-app',
  reason: 'owner_request',
  details: 'This is my repo',
  is_public: true,
  share_blocked: false,
  report_count: 2,
  created_at: '2026-10-18T10:00:00Z',
  ...overrides,
});

describe('AdminReportsPage', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockBlock.mockReset();
  });

  it('shows the empty state', async () => {
    mockList.mockResolvedValue({ items: [], total: 0, page: 1, size: 20 });
    renderWithProviders(<AdminReportsPage />, { route: '/admin/reports', auth: admin });
    expect(await screen.findByText(/No reports/)).toBeInTheDocument();
  });

  it('lists reports and blocks sharing', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({ items: [makeReport()], total: 1, page: 1, size: 20 });
    mockBlock.mockResolvedValue(makeAdminRoast({ share_blocked: true }));
    renderWithProviders(<AdminReportsPage />, { route: '/admin/reports', auth: admin });

    expect(await screen.findByText('octo/todo-app')).toBeInTheDocument();
    expect(screen.getByText('Owner request')).toBeInTheDocument();
    expect(screen.getByText('This is my repo')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Block sharing' }));
    await waitFor(() => expect(mockBlock).toHaveBeenCalledWith(7, true));
  });
});
