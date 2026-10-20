import { useCallback, useEffect, useState } from 'react';
import { getRoastQuota } from '../services/roastApi';
import type { RoastQuota } from '../types/roast';

export interface UseRoastQuotaResult {
  quota: RoastQuota | null;
  refresh: () => Promise<void>;
}

/** Loads the user's daily roast allowance. Purely informational, so failures are ignored. */
export function useRoastQuota(): UseRoastQuotaResult {
  const [quota, setQuota] = useState<RoastQuota | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(getRoastQuota)
      .then((next) => {
        if (!cancelled) setQuota(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setQuota(await getRoastQuota());
    } catch {
      // The allowance is informational; keep showing the last known value.
    }
  }, []);

  return { quota, refresh };
}
