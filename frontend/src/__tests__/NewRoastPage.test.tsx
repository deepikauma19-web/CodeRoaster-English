import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NewRoastPage from '../pages/NewRoastPage';
import { createRoast, getRoastQuota, listRoasts } from '../services/roastApi';
import { authedValue, axiosError, makeRoast } from './utils/fixtures';
import { renderWithProviders } from './utils/renderWithProviders';

vi.mock('../services/roastApi', () => ({
  createRoast: vi.fn(),
  listRoasts: vi.fn(),
  getRoastQuota: vi.fn(),
}));

const mockCreate = vi.mocked(createRoast);
const mockList = vi.mocked(listRoasts);
const mockQuota = vi.mocked(getRoastQuota);

const renderPage = () =>
  renderWithProviders(<NewRoastPage />, {
    route: '/roast/new',
    auth: authedValue(),
    extraRoutes: <Route path="/roasts/:id" element={<div data-testid="result-page" />} />,
  });

const urlInput = (): HTMLElement => screen.getByLabelText(/GitHub repo URL/);
const submitButton = (): HTMLElement => screen.getByRole('button', { name: /Roast Me/ });

describe('NewRoastPage', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockList.mockReset();
    mockQuota.mockReset();
    mockQuota.mockResolvedValue({ limit: 10, used: 3, remaining: 7, resets_at: null });
    mockList.mockResolvedValue({ items: [], total: 0, page: 1, size: 5 });
  });

  it('shows an inline error for an invalid URL and does not call createRoast', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(urlInput(), 'https://gitlab.com/foo/bar');
    await user.click(submitButton());
    expect(await screen.findByText(/Enter a valid GitHub repo URL/)).toBeInTheDocument();
    expect(urlInput()).toHaveAttribute('aria-invalid', 'true');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('requires a URL', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(submitButton());
    expect(await screen.findByText('Please enter a repo URL!')).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('validates on blur and clears the error once fixed', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(urlInput(), 'nope');
    await user.tab();
    expect(await screen.findByText(/Enter a valid GitHub repo URL/)).toBeInTheDocument();
    await user.clear(urlInput());
    await user.type(urlInput(), 'https://github.com/a/b');
    expect(screen.queryByText(/Enter a valid GitHub repo URL/)).not.toBeInTheDocument();
  });

  it('submits {repo_url, intensity} and navigates to /roasts/:id', async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue(makeRoast({ id: 77, status: 'pending' }));
    renderPage();
    await user.type(urlInput(), '  https://github.com/octo/todo-app  ');
    await user.click(screen.getByText('Extra Spicy'));
    await user.click(submitButton());
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/roasts/77'));
    expect(mockCreate).toHaveBeenCalledWith({ repo_url: 'https://github.com/octo/todo-app', intensity: 'extra_spicy' });
    expect(screen.getByTestId('result-page')).toBeInTheDocument();
  });

  it('defaults intensity to medium', async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue(makeRoast({ id: 5 }));
    renderPage();
    await user.type(urlInput(), 'https://github.com/octo/todo-app');
    await user.click(submitButton());
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith({ repo_url: 'https://github.com/octo/todo-app', intensity: 'medium' }));
  });

  it('shows the server error and stays on the page', async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValue(axiosError(429, { detail: 'Rate limit: 10 roasts per hour' }));
    renderPage();
    await user.type(urlInput(), 'https://github.com/octo/todo-app');
    await user.click(submitButton());
    expect(await screen.findByTestId('server-error')).toHaveTextContent('Rate limit: 10 roasts per hour');
    expect(screen.getByTestId('location')).toHaveTextContent('/roast/new');
    expect(submitButton()).not.toBeDisabled();
  });

  it('lists recent roasts with scores and statuses', async () => {
    mockList.mockResolvedValue({
      items: [
        makeRoast({ id: 1, repo_name: 'alpha', overall_score: 91 }),
        makeRoast({ id: 2, repo_name: 'beta', status: 'analyzing', overall_score: null }),
      ],
      total: 2,
      page: 1,
      size: 5,
    });
    renderPage();
    expect(await screen.findByText('octo/alpha')).toBeInTheDocument();
    expect(screen.getByText('91/100')).toBeInTheDocument();
    expect(screen.getByText('analyzing')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'octo/beta' })).toHaveAttribute('href', '/roasts/2');
    expect(mockList).toHaveBeenCalledWith({ page: 1, size: 5 });
  });

  it('shows empty and error states for recent roasts', async () => {
    const { unmount } = renderPage();
    expect(await screen.findByText(/No roasts yet/)).toBeInTheDocument();
    unmount();
    mockList.mockRejectedValue(axiosError(500, { detail: 'list failed' }));
    renderPage();
    expect(await screen.findByText('list failed')).toBeInTheDocument();
  });

  it('shows how many roasts are left today', async () => {
    renderPage();
    expect(await screen.findByTestId('quota-remaining')).toHaveTextContent('7 of 10 roasts left today');
    expect(screen.queryByTestId('quota-exhausted')).not.toBeInTheDocument();
  });

  it('hides the counter for unlimited users', async () => {
    mockQuota.mockResolvedValue({ limit: null, used: 4, remaining: null, resets_at: null });
    renderPage();
    await waitFor(() => expect(mockQuota).toHaveBeenCalled());
    expect(screen.queryByTestId('quota-remaining')).not.toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  it('disables the button and explains when the daily limit is used up', async () => {
    mockQuota.mockResolvedValue({
      limit: 10,
      used: 10,
      remaining: 0,
      resets_at: '2026-10-19T08:30:00Z',
    });
    renderPage();
    expect(await screen.findByTestId('quota-exhausted')).toHaveTextContent(/used all 10 roasts for today/);
    expect(submitButton()).toBeDisabled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('keeps working when the quota request fails', async () => {
    mockQuota.mockRejectedValue(axiosError(500, { detail: 'boom' }));
    renderPage();
    await waitFor(() => expect(mockQuota).toHaveBeenCalled());
    expect(submitButton()).toBeEnabled();
    expect(screen.queryByTestId('quota-remaining')).not.toBeInTheDocument();
  });

  it('shows the server message and refreshes the allowance on a 429', async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValue(axiosError(429, { detail: 'You have used all 10 roasts for today.' }));
    renderPage();
    await user.type(urlInput(), 'https://github.com/octo/hello');
    await user.click(submitButton());
    expect(await screen.findByTestId('server-error')).toHaveTextContent(/used all 10 roasts/);
    await waitFor(() => expect(mockQuota).toHaveBeenCalledTimes(2));
  });
});
