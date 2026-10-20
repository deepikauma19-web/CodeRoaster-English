import axios, { type AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import type { TokenResponse } from '../types';

const API_BASE_URL = `${import.meta.env.VITE_API_URL ?? ''}/api/v1`;
const REFRESH_PATH = '/auth/refresh';

let accessToken: string | null = null;
let onAuthFailure: (() => void) | null = null;
let refreshPromise: Promise<string> | null = null;

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

export const getAccessToken = (): string | null => accessToken;

/** Register a callback fired when a token refresh fails (e.g. log out + redirect). */
export const setOnAuthFailure = (fn: (() => void) | null): void => {
  onAuthFailure = fn;
};

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return config;
});

interface RetriableConfig extends AxiosRequestConfig {
  _retry?: boolean;
}

const isRefreshRequest = (config: AxiosRequestConfig | undefined): boolean =>
  Boolean(config?.url?.includes(REFRESH_PATH));

/** Single-flight refresh: concurrent 401s share one refresh call. */
const refreshAccessToken = (): Promise<string> => {
  if (!refreshPromise) {
    refreshPromise = api
      .post<TokenResponse>(REFRESH_PATH)
      .then(({ data }) => {
        setAccessToken(data.access_token);
        return data.access_token;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
};

api.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) {
      return Promise.reject(error);
    }
    const original = error.config as RetriableConfig | undefined;
    if (error.response?.status !== 401 || !original || original._retry || isRefreshRequest(original)) {
      return Promise.reject(error);
    }
    original._retry = true;
    try {
      // The request interceptor attaches the freshly stored token on retry.
      await refreshAccessToken();
      return api(original);
    } catch (refreshError: unknown) {
      setAccessToken(null);
      onAuthFailure?.();
      return Promise.reject(refreshError);
    }
  },
);

interface ApiErrorBody {
  detail?: string | Array<{ msg?: string }>;
  message?: string;
}

/** Extract a human-readable message from any thrown value (axios errors included). */
export const getErrorMessage = (err: unknown): string => {
  if (axios.isAxiosError(err)) {
    const axiosErr = err as AxiosError<ApiErrorBody>;
    const body = axiosErr.response?.data;
    if (body) {
      if (typeof body.detail === 'string') return body.detail;
      if (Array.isArray(body.detail) && body.detail.length > 0) {
        return body.detail.map((d) => d.msg ?? 'Invalid input').join(', ');
      }
      if (typeof body.message === 'string') return body.message;
    }
    if (!axiosErr.response) return 'Could not reach the server. Please check your network.';
    return axiosErr.message;
  }
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Something went wrong. Please try again.';
};

export default api;
