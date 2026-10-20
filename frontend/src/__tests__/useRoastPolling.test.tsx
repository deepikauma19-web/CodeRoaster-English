import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLL_INTERVAL_MS, POLL_TIMEOUT_MESSAGE, POLL_TIMEOUT_MS, useRoastPolling } from '../hooks/useRoastPolling';
import { getRoast, getRoastStatus } from '../services/roastApi';
import { axiosError, makeRoast } from './utils/fixtures';

vi.mock('../services/roastApi', () => ({
  getRoast: vi.fn(),
  getRoastStatus: vi.fn(),
}));

const mockGetRoast = vi.mocked(getRoast);
const mockGetStatus = vi.mocked(getRoastStatus);

const advance = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('useRoastPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGetRoast.mockReset();
    mockGetStatus.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls status every 2s until terminal, then fetches the full roast once', async () => {
    mockGetRoast
      .mockResolvedValueOnce(makeRoast({ status: 'pending', overall_score: null }))
      .mockResolvedValueOnce(makeRoast({ status: 'completed', overall_score: 88 }));
    mockGetStatus
      .mockResolvedValueOnce({ id: 42, status: 'fetching', error_message: null })
      .mockResolvedValueOnce({ id: 42, status: 'analyzing', error_message: null })
      .mockResolvedValueOnce({ id: 42, status: 'completed', error_message: null });

    const { result } = renderHook(() => useRoastPolling('42'));
    await waitFor(() => expect(result.current.roast?.status).toBe('pending'));
    expect(result.current.isLoading).toBe(false);
    expect(mockGetStatus).not.toHaveBeenCalled();

    await advance(POLL_INTERVAL_MS);
    expect(mockGetStatus).toHaveBeenCalledTimes(1);
    expect(mockGetStatus).toHaveBeenCalledWith('42');
    expect(result.current.roast?.status).toBe('fetching');

    await advance(POLL_INTERVAL_MS);
    expect(mockGetStatus).toHaveBeenCalledTimes(2);
    expect(result.current.roast?.status).toBe('analyzing');

    await advance(POLL_INTERVAL_MS);
    expect(mockGetStatus).toHaveBeenCalledTimes(3);
    expect(mockGetRoast).toHaveBeenCalledTimes(2);
    expect(result.current.roast?.status).toBe('completed');
    expect(result.current.roast?.overall_score).toBe(88);

    // Terminal → no more polling.
    await advance(POLL_INTERVAL_MS * 5);
    expect(mockGetStatus).toHaveBeenCalledTimes(3);
    expect(result.current.error).toBeNull();
  });

  it('does not poll when the initial roast is already terminal', async () => {
    mockGetRoast.mockResolvedValue(makeRoast({ status: 'completed' }));
    const { result } = renderHook(() => useRoastPolling(42));
    await waitFor(() => expect(result.current.roast?.status).toBe('completed'));
    await advance(POLL_INTERVAL_MS * 3);
    expect(mockGetStatus).not.toHaveBeenCalled();
  });

  it('stops polling on unmount', async () => {
    mockGetRoast.mockResolvedValue(makeRoast({ status: 'pending' }));
    mockGetStatus.mockResolvedValue({ id: 42, status: 'pending', error_message: null });
    const { result, unmount } = renderHook(() => useRoastPolling('42'));
    await waitFor(() => expect(result.current.roast).not.toBeNull());
    await advance(POLL_INTERVAL_MS);
    expect(mockGetStatus).toHaveBeenCalledTimes(1);
    unmount();
    await advance(POLL_INTERVAL_MS * 10);
    expect(mockGetStatus).toHaveBeenCalledTimes(1);
  });

  it('sets notFound when the roast 404s', async () => {
    mockGetRoast.mockRejectedValue(axiosError(404, { detail: 'Roast not found' }));
    const { result } = renderHook(() => useRoastPolling('999'));
    await waitFor(() => expect(result.current.notFound).toBe(true));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets notFound when /status 404s mid-poll (e.g. deleted)', async () => {
    mockGetRoast.mockResolvedValue(makeRoast({ status: 'analyzing' }));
    mockGetStatus.mockRejectedValue(axiosError(404));
    const { result } = renderHook(() => useRoastPolling('42'));
    await waitFor(() => expect(result.current.roast).not.toBeNull());
    await advance(POLL_INTERVAL_MS);
    expect(result.current.notFound).toBe(true);
    await advance(POLL_INTERVAL_MS * 3);
    expect(mockGetStatus).toHaveBeenCalledTimes(1);
  });

  it('errors after the polling timeout', async () => {
    mockGetRoast.mockResolvedValue(makeRoast({ status: 'pending' }));
    mockGetStatus.mockResolvedValue({ id: 42, status: 'pending', error_message: null });
    const { result } = renderHook(() => useRoastPolling('42'));
    await waitFor(() => expect(result.current.roast).not.toBeNull());
    await advance(POLL_TIMEOUT_MS + POLL_INTERVAL_MS);
    expect(result.current.error).toBe(POLL_TIMEOUT_MESSAGE);
    const calls = mockGetStatus.mock.calls.length;
    await advance(POLL_INTERVAL_MS * 5);
    expect(mockGetStatus).toHaveBeenCalledTimes(calls);
  });

  it('tolerates transient status failures but gives up after 3 in a row', async () => {
    mockGetRoast.mockResolvedValue(makeRoast({ status: 'pending' }));
    mockGetStatus.mockRejectedValue(axiosError(500, { detail: 'DB down' }));
    const { result } = renderHook(() => useRoastPolling('42'));
    await waitFor(() => expect(result.current.roast).not.toBeNull());
    await advance(POLL_INTERVAL_MS * 2);
    expect(result.current.error).toBeNull();
    await advance(POLL_INTERVAL_MS);
    expect(mockGetStatus).toHaveBeenCalledTimes(3);
    expect(result.current.error).toBe('DB down');
    expect(result.current.notFound).toBe(false);
  });

  it('surfaces non-404 initial fetch errors', async () => {
    mockGetRoast.mockRejectedValue(axiosError(500, { detail: 'boom' }));
    const { result } = renderHook(() => useRoastPolling('42'));
    await waitFor(() => expect(result.current.error).toBe('boom'));
    expect(result.current.isLoading).toBe(false);
  });

  it('refetch restarts polling (e.g. after retry)', async () => {
    mockGetRoast
      .mockResolvedValueOnce(makeRoast({ status: 'failed' }))
      .mockResolvedValueOnce(makeRoast({ status: 'pending' }))
      .mockResolvedValueOnce(makeRoast({ status: 'completed' }));
    mockGetStatus.mockResolvedValue({ id: 42, status: 'completed', error_message: null });
    const { result } = renderHook(() => useRoastPolling('42'));
    await waitFor(() => expect(result.current.roast?.status).toBe('failed'));
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.roast?.status).toBe('pending'));
    await advance(POLL_INTERVAL_MS);
    expect(result.current.roast?.status).toBe('completed');
  });

  it('treats a missing id as not found without fetching', () => {
    const { result } = renderHook(() => useRoastPolling(undefined));
    expect(result.current.notFound).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(mockGetRoast).not.toHaveBeenCalled();
  });
});
