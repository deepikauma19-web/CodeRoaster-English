import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api, { getAccessToken, setAccessToken, setOnAuthFailure } from '../services/api';
import type { TokenResponse } from '../types';

interface AdapterLog {
  url: string;
  auth: string | null;
}

const ok = <T>(config: InternalAxiosRequestConfig, data: T, status = 200): AxiosResponse<T> => ({
  data,
  status,
  statusText: 'OK',
  headers: {},
  config,
});

const unauthorized = (config: InternalAxiosRequestConfig): AxiosError =>
  new AxiosError('Request failed with status code 401', 'ERR_BAD_REQUEST', config, null, {
    data: { detail: 'Not authenticated' },
    status: 401,
    statusText: 'Unauthorized',
    headers: {},
    config,
  });

const authHeader = (config: InternalAxiosRequestConfig): string | null => {
  const value = config.headers.get('Authorization');
  return typeof value === 'string' ? value : null;
};

describe('api interceptors', () => {
  const originalAdapter = api.defaults.adapter;
  let log: AdapterLog[];
  let refreshCalls: number;
  let refreshSucceeds: boolean;

  beforeEach(() => {
    log = [];
    refreshCalls = 0;
    refreshSucceeds = true;
    setAccessToken('expired');
    api.defaults.adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
      const url = config.url ?? '';
      log.push({ url, auth: authHeader(config) });
      if (url.includes('/auth/refresh')) {
        refreshCalls += 1;
        // Resolve on a later tick so concurrent 401s overlap with the in-flight refresh.
        await new Promise((r) => setTimeout(r, 20));
        if (!refreshSucceeds) throw unauthorized(config);
        return ok<TokenResponse>(config, { access_token: 'fresh', token_type: 'bearer' });
      }
      if (authHeader(config) === 'Bearer fresh') return ok(config, { url });
      throw unauthorized(config);
    };
  });

  afterEach(() => {
    api.defaults.adapter = originalAdapter;
    setAccessToken(null);
    setOnAuthFailure(null);
  });

  it('attaches the bearer token', async () => {
    setAccessToken('fresh');
    const res = await api.get<{ url: string }>('/auth/me');
    expect(res.data.url).toBe('/auth/me');
    expect(log[0].auth).toBe('Bearer fresh');
  });

  it('sends no Authorization header without a token (then refreshes on 401)', async () => {
    setAccessToken(null);
    await api.get('/roasts');
    expect(log[0].auth).toBeNull();
    expect(log[1].url).toBe('/auth/refresh');
    expect(log[2].auth).toBe('Bearer fresh');
  });

  it('concurrent 401s share a single refresh call, then retry with the new token', async () => {
    const results = await Promise.all([api.get('/roasts'), api.get('/roasts/1'), api.get('/auth/me')]);
    expect(refreshCalls).toBe(1);
    expect(results.map((r) => (r.data as { url: string }).url)).toEqual(['/roasts', '/roasts/1', '/auth/me']);
    expect(getAccessToken()).toBe('fresh');
    const retries = log.filter((l) => l.auth === 'Bearer fresh');
    expect(retries.map((r) => r.url).sort()).toEqual(['/auth/me', '/roasts', '/roasts/1']);
  });

  it('a later 401 after a completed refresh triggers a new refresh', async () => {
    await api.get('/roasts');
    setAccessToken('expired-again');
    await api.get('/roasts');
    expect(refreshCalls).toBe(2);
  });

  it('refresh failure rejects all callers, clears the token and fires onAuthFailure once per caller', async () => {
    refreshSucceeds = false;
    const onAuthFailure = vi.fn();
    setOnAuthFailure(onAuthFailure);
    const settled = await Promise.allSettled([api.get('/roasts'), api.get('/auth/me')]);
    expect(settled.every((s) => s.status === 'rejected')).toBe(true);
    expect(refreshCalls).toBe(1);
    expect(getAccessToken()).toBeNull();
    expect(onAuthFailure).toHaveBeenCalled();
  });

  it('does not try to refresh when the refresh call itself 401s', async () => {
    refreshSucceeds = false;
    await expect(api.post('/auth/refresh')).rejects.toBeInstanceOf(AxiosError);
    expect(refreshCalls).toBe(1);
  });

  it('only retries once per request', async () => {
    // Refresh "succeeds" but the server keeps returning 401 for the retried request.
    api.defaults.adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
      const url = config.url ?? '';
      log.push({ url, auth: authHeader(config) });
      if (url.includes('/auth/refresh')) {
        refreshCalls += 1;
        return ok<TokenResponse>(config, { access_token: 'fresh', token_type: 'bearer' });
      }
      throw unauthorized(config);
    };
    await expect(api.get('/roasts')).rejects.toBeInstanceOf(AxiosError);
    expect(refreshCalls).toBe(1);
    expect(log.filter((l) => l.url === '/roasts')).toHaveLength(2);
  });

  it('passes non-401 errors straight through', async () => {
    api.defaults.adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
      throw new AxiosError('boom', 'ERR_BAD_RESPONSE', config, null, {
        data: {},
        status: 500,
        statusText: 'err',
        headers: {},
        config,
      });
    };
    await expect(api.get('/roasts')).rejects.toMatchObject({ response: { status: 500 } });
  });
});
