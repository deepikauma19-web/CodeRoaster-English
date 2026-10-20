import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RoastResultPage from '../pages/RoastResultPage';
import { deleteRoast, getRoast, getRoastStatus, retryRoast } from '../services/roastApi';
import { toggleRoastShare } from '../services/shareApi';
import { authedValue, axiosError, makeRoast } from './utils/fixtures';
import { renderWithProviders } from './utils/renderWithProviders';

vi.mock('../services/roastApi', () => ({
  getRoast: vi.fn(),
  getRoastStatus: vi.fn(),
  retryRoast: vi.fn(),
  deleteRoast: vi.fn(),
}));

vi.mock('../services/shareApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/shareApi')>();
  return { ...actual, toggleRoastShare: vi.fn() };
});

const mockGetRoast = vi.mocked(getRoast);
const mockGetStatus = vi.mocked(getRoastStatus);
const mockRetry = vi.mocked(retryRoast);
const mockDelete = vi.mocked(deleteRoast);
const mockToggle = vi.mocked(toggleRoastShare);

const renderPage = (id = '42') =>
  renderWithProviders(<RoastResultPage />, {
    route: `/roasts/${id}`,
    path: '/roasts/:id',
    auth: authedValue(),
    extraRoutes: <Route path="/roast/new" element={<div data-testid="new-roast-page" />} />,
  });

describe('RoastResultPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    for (const m of [mockGetRoast, mockGetStatus, mockRetry, mockDelete, mockToggle]) m.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the loader while pending and then the result when completed', async () => {
    mockGetRoast
      .mockResolvedValueOnce(makeRoast({ status: 'pending', overall_score: null }))
      .mockResolvedValueOnce(makeRoast({ status: 'completed', overall_score: 85 }));
    mockGetStatus.mockResolvedValue({ id: 42, status: 'completed', error_message: null });
    renderPage();
    expect(await screen.findByTestId('roast-loader')).toBeInTheDocument();
    expect(screen.queryByTestId('roast-completed')).not.toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await screen.findByTestId('roast-completed')).toBeInTheDocument();
    expect(screen.queryByTestId('roast-loader')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Score 85 out of 100/ })).toBeInTheDocument();
  });

  it('completed roast shows score, breakdown, tips, meta and share controls', async () => {
    mockGetRoast.mockResolvedValue(makeRoast({ overall_score: 72 }));
    renderPage();
    expect(await screen.findByTestId('roast-completed')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Score 72 out of 100: Decent' })).toBeInTheDocument();
    expect(screen.getByTestId('score-breakdown')).toBeInTheDocument();
    expect(screen.getByTestId('tips-list')).toBeInTheDocument();
    expect(screen.getByTestId('roast-card')).toBeInTheDocument();
    expect(screen.getByTestId('repo-meta')).toBeInTheDocument();
    expect(screen.getByText('Decent repo, docs weak.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Make public' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /octo\/todo-app/ })).toHaveAttribute('href', 'https://github.com/octo/todo-app');
    expect(screen.queryByTestId('roast-warning')).not.toBeInTheDocument();
  });

  it('completed roast with error_message shows a warning', async () => {
    mockGetRoast.mockResolvedValue(makeRoast({ error_message: 'Only 50 of 300 files analyzed' }));
    renderPage();
    expect(await screen.findByTestId('roast-warning')).toHaveTextContent('Only 50 of 300 files analyzed');
    expect(screen.getByTestId('roast-completed')).toBeInTheDocument();
  });

  it('failed roast shows the error and a working retry', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockGetRoast
      .mockResolvedValueOnce(makeRoast({ status: 'failed', error_message: 'Repo is private', overall_score: null }))
      .mockResolvedValueOnce(makeRoast({ status: 'pending', overall_score: null }));
    mockGetStatus.mockResolvedValue({ id: 42, status: 'pending', error_message: null });
    mockRetry.mockResolvedValue(makeRoast({ status: 'pending' }));
    renderPage();
    const failed = await screen.findByTestId('roast-failed');
    expect(failed).toHaveTextContent('Repo is private');
    await user.click(within(failed).getByRole('button', { name: /Retry/ }));
    expect(mockRetry).toHaveBeenCalledWith(42);
    expect(await screen.findByTestId('roast-loader')).toBeInTheDocument();
    expect(mockGetRoast).toHaveBeenCalledTimes(2);
  });

  it('failed retry shows an error toast', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockGetRoast.mockResolvedValue(makeRoast({ status: 'failed', error_message: null }));
    mockRetry.mockRejectedValue(axiosError(409, { detail: 'Only failed roasts can be retried' }));
    renderPage();
    const failed = await screen.findByTestId('roast-failed');
    expect(failed).toHaveTextContent('Something went wrong');
    await user.click(within(failed).getByRole('button', { name: /Retry/ }));
    expect(await screen.findByText('Only failed roasts can be retried')).toBeInTheDocument();
  });

  it('shows not-found state on 404', async () => {
    mockGetRoast.mockRejectedValue(axiosError(404));
    renderPage('999');
    expect(await screen.findByTestId('roast-not-found')).toBeInTheDocument();
  });

  it('shows an error with reload', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockGetRoast.mockRejectedValueOnce(axiosError(500, { detail: 'Server sad' })).mockResolvedValueOnce(makeRoast());
    renderPage();
    const alert = await screen.findByTestId('roast-error');
    expect(alert).toHaveTextContent('Server sad');
    await user.click(within(alert).getByRole('button', { name: 'Reload' }));
    expect(await screen.findByTestId('roast-completed')).toBeInTheDocument();
  });

  it('delete confirms, calls deleteRoast and navigates to /roast/new', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockGetRoast.mockResolvedValue(makeRoast({ id: 42 }));
    mockDelete.mockResolvedValue(undefined);
    renderPage();
    await screen.findByTestId('roast-completed');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(42));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/roast/new'));
  });

  it('delete failure shows a toast and stays', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockGetRoast.mockResolvedValue(makeRoast({ id: 42 }));
    mockDelete.mockRejectedValue(axiosError(500, { detail: 'nope' }));
    renderPage();
    await screen.findByTestId('roast-completed');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Could not delete the roast')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/roasts/42');
  });

  it('share toggle updates the page roast', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockGetRoast.mockResolvedValue(makeRoast({ id: 42 }));
    mockToggle.mockResolvedValue({ is_public: true, share_slug: 's1', share_url: 'http://x/api/v1/public/share/s1' });
    renderPage();
    await screen.findByTestId('roast-completed');
    await user.click(screen.getByRole('checkbox', { name: 'Make public' }));
    expect(await screen.findByLabelText('Share link')).toHaveValue('http://x/api/v1/public/share/s1');
  });
});
