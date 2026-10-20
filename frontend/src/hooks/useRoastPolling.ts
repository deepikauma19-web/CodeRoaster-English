import axios from 'axios';
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { getErrorMessage } from '../services/api';
import { getRoast, getRoastStatus } from '../services/roastApi';
import { isTerminalStatus } from '../lib/roastUi';
import type { Roast } from '../types/roast';

export const POLL_INTERVAL_MS = 2000;
export const POLL_TIMEOUT_MS = 3 * 60 * 1000;
/** Consecutive /status failures tolerated before giving up. */
const MAX_POLL_FAILURES = 3;

export const POLL_TIMEOUT_MESSAGE = 'The roast is taking too long. Please refresh in a little while.';

export interface UseRoastPollingResult {
  roast: Roast | null;
  isLoading: boolean;
  error: string | null;
  /** True when the roast does not exist (or isn't owned by the user → backend 404). */
  notFound: boolean;
  /** Re-fetch the full roast and restart polling if it is not terminal (e.g. after retry). */
  refetch: () => void;
  setRoast: Dispatch<SetStateAction<Roast | null>>;
}

const isNotFoundError = (err: unknown): boolean => axios.isAxiosError(err) && err.response?.status === 404;

/**
 * Fetch a roast, then poll `/roasts/{id}/status` every 2 s while it is not terminal.
 * On a terminal status the full roast is fetched once. Polling stops on unmount and
 * gives up with an error after 3 minutes.
 */
export function useRoastPolling(id: number | string | undefined): UseRoastPollingResult {
  const [roast, setRoast] = useState<Roast | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<boolean>(false);
  const [reloadKey, setReloadKey] = useState<number>(0);

  const missingId = id === undefined || id === '';

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (missingId) return undefined;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    let failures = 0;

    const fail = (err: unknown): void => {
      if (cancelled) return;
      if (isNotFoundError(err)) {
        setNotFound(true);
      } else {
        setError(getErrorMessage(err));
      }
      setIsLoading(false);
    };

    const fetchFull = async (): Promise<Roast | null> => {
      try {
        const full = await getRoast(id);
        if (!cancelled) setRoast(full);
        return full;
      } catch (err: unknown) {
        fail(err);
        return null;
      }
    };

    const schedulePoll = (): void => {
      timer = setTimeout(() => {
        void poll();
      }, POLL_INTERVAL_MS);
    };

    const poll = async (): Promise<void> => {
      if (cancelled) return;
      if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        setError(POLL_TIMEOUT_MESSAGE);
        setIsLoading(false);
        return;
      }
      try {
        const status = await getRoastStatus(id);
        if (cancelled) return;
        failures = 0;
        if (isTerminalStatus(status.status)) {
          await fetchFull();
          return;
        }
        setRoast((prev) =>
          prev ? { ...prev, status: status.status, error_message: status.error_message } : prev,
        );
        schedulePoll();
      } catch (err: unknown) {
        if (cancelled) return;
        failures += 1;
        if (isNotFoundError(err) || failures >= MAX_POLL_FAILURES) {
          fail(err);
          return;
        }
        schedulePoll();
      }
    };

    const start = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);
      setNotFound(false);
      const full = await fetchFull();
      if (cancelled || !full) return;
      setIsLoading(false);
      if (!isTerminalStatus(full.status)) schedulePoll();
    };

    void start();

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [id, missingId, reloadKey]);

  return {
    roast,
    isLoading: missingId ? false : isLoading,
    error,
    notFound: missingId || notFound,
    refetch,
    setRoast,
  };
}

export default useRoastPolling;
