import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '../../services/api';
import { isAbortError } from './format';

interface QueryState<T> {
  /** Key of the request that produced this state. */
  key: string | null;
  data: T | null;
  error: string | null;
}

export interface AbortableQuery<T> {
  /** Most recent successful data (kept while a new request is in flight). */
  data: T | null;
  error: string | null;
  isLoading: boolean;
  /** Re-run the current request. */
  refetch: () => void;
  /** Locally patch the cached data (e.g. after a mutation). */
  setData: (updater: (prev: T | null) => T | null) => void;
}

/**
 * Fetches whenever `key` changes, aborting the previous in-flight request so
 * stale responses never overwrite newer ones. Loading is derived from whether
 * the settled state belongs to the current key.
 */
export function useAbortableQuery<T>(
  key: string,
  fetcher: (signal: AbortSignal) => Promise<T>,
  enabled = true,
): AbortableQuery<T> {
  const [state, setState] = useState<QueryState<T>>({ key: null, data: null, error: null });
  const [reload, setReload] = useState(0);
  const fetcherRef = useRef(fetcher);

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  const requestKey = `${key}#${reload}`;

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    fetcherRef.current(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({ key: requestKey, data, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return;
        setState((prev) => ({ key: requestKey, data: prev.data, error: getErrorMessage(err) }));
      });
    return () => controller.abort();
  }, [requestKey, enabled]);

  const refetch = useCallback(() => setReload((n) => n + 1), []);
  const setData = useCallback((updater: (prev: T | null) => T | null) => {
    setState((prev) => ({ ...prev, data: updater(prev.data) }));
  }, []);

  const settled = state.key === requestKey;
  return {
    data: state.data,
    error: settled ? state.error : null,
    isLoading: enabled && !settled,
    refetch,
    setData,
  };
}

export default useAbortableQuery;
