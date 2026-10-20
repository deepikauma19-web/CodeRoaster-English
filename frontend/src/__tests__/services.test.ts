import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteAdminRoast,
  getAdminStats,
  listAdminRoasts,
  listAdminUsers,
  updateAdminUser,
} from '../services/adminApi';
import api, { setAccessToken } from '../services/api';
import { authService } from '../services/authService';
import { createRoast, deleteRoast, getRoast, getRoastStatus, listRoasts, retryRoast } from '../services/roastApi';
import { getPublicRoast, toggleRoastShare } from '../services/shareApi';

interface Captured {
  method: string;
  url: string;
  params: unknown;
  data: unknown;
}

describe('service modules send the right requests', () => {
  const originalAdapter = api.defaults.adapter;
  let calls: Captured[];

  beforeEach(() => {
    calls = [];
    setAccessToken('t');
    api.defaults.adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
      calls.push({
        method: (config.method ?? '').toUpperCase(),
        url: config.url ?? '',
        params: config.params,
        data: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
      });
      return { data: { echoed: true }, status: 200, statusText: 'OK', headers: {}, config };
    };
  });

  afterEach(() => {
    api.defaults.adapter = originalAdapter;
    setAccessToken(null);
  });

  it('roastApi', async () => {
    await createRoast({ repo_url: 'https://github.com/a/b', intensity: 'mild' });
    await getRoast(1);
    await getRoastStatus('2');
    await retryRoast(3);
    await deleteRoast(4);
    await listRoasts();
    await listRoasts({ page: 2, size: 3 });
    expect(calls).toEqual([
      { method: 'POST', url: '/roasts', params: undefined, data: { repo_url: 'https://github.com/a/b', intensity: 'mild' } },
      { method: 'GET', url: '/roasts/1', params: undefined, data: undefined },
      { method: 'GET', url: '/roasts/2/status', params: undefined, data: undefined },
      { method: 'POST', url: '/roasts/3/retry', params: undefined, data: undefined },
      { method: 'DELETE', url: '/roasts/4', params: undefined, data: undefined },
      { method: 'GET', url: '/roasts', params: { page: 1, size: 10 }, data: undefined },
      { method: 'GET', url: '/roasts', params: { page: 2, size: 3 }, data: undefined },
    ]);
  });

  it('shareApi', async () => {
    await toggleRoastShare(5, true);
    await expect(getPublicRoast('a/b')).resolves.toEqual({ echoed: true });
    expect(calls[0]).toMatchObject({ method: 'PATCH', url: '/roasts/5/share', data: { is_public: true } });
    expect(calls[1]).toMatchObject({ method: 'GET', url: '/public/roasts/a%2Fb' });
  });

  it('adminApi drops empty params', async () => {
    await getAdminStats();
    await listAdminUsers({ search: '', page: 1, size: 20 });
    await listAdminUsers({ search: 'deep', page: 2 });
    await updateAdminUser(7, { is_admin: false });
    await listAdminRoasts({ status: undefined, from: '2026-01-01', page: 1 });
    await deleteAdminRoast(9);
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/admin/stats' });
    expect(calls[1].params).toEqual({ page: 1, size: 20 });
    expect(calls[2].params).toEqual({ search: 'deep', page: 2 });
    expect(calls[3]).toMatchObject({ method: 'PUT', url: '/admin/users/7', data: { is_admin: false } });
    expect(calls[4].params).toEqual({ from: '2026-01-01', page: 1 });
    expect(calls[5]).toMatchObject({ method: 'DELETE', url: '/admin/roasts/9' });
  });

  it('authService', async () => {
    await authService.refresh();
    await authService.me();
    await authService.logout();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /auth/refresh', 'GET /auth/me', 'POST /auth/logout']);
  });
});
