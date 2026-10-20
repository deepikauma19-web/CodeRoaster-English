import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { vi } from 'vitest';
import type { AdminRoast, AdminStats, AdminUser, PublicRoastResponse, Roast, User } from '../../types';
import type { AuthContextValue } from '../../types/auth';

export const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 1,
  email: 'dev@example.com',
  full_name: 'Dev Kumar',
  avatar_url: null,
  is_admin: false,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  last_login_at: '2026-10-01T10:00:00Z',
  ...overrides,
});

export const makeRoast = (overrides: Partial<Roast> = {}): Roast => ({
  id: 42,
  repo_url: 'https://github.com/octo/todo-app',
  repo_owner: 'octo',
  repo_name: 'todo-app',
  intensity: 'medium',
  status: 'completed',
  overall_score: 72,
  score_breakdown: {
    code_quality: 15,
    structure: 14,
    documentation: 10,
    ai_best_practices: 18,
    security: 15,
  },
  roast_text: 'Bro, 400 lines in **main.py**?',
  summary: 'Decent repo, docs weak.',
  tips: [
    { title: 'Split main.py', description: 'Too long.', priority: 'high', file_path: 'main.py' },
    { title: 'Add README', description: 'Write docs.', priority: 'low', file_path: null },
  ],
  files_analyzed: 12,
  language_breakdown: { Python: 90, Shell: 10 },
  error_message: null,
  is_public: false,
  share_slug: null,
  secrets_detected: 0,
  share_blocked: false,
  created_at: '2026-10-01T10:00:00Z',
  completed_at: '2026-10-01T10:01:00Z',
  ...overrides,
});

export const makePublicRoast = (overrides: Partial<PublicRoastResponse> = {}): PublicRoastResponse => ({
  repo_owner: 'octo',
  repo_name: 'todo-app',
  repo_url: 'https://github.com/octo/todo-app',
  intensity: 'extra_spicy',
  overall_score: 35,
  score_breakdown: {
    code_quality: 5,
    structure: 8,
    documentation: 4,
    ai_best_practices: 10,
    security: 8,
  },
  roast_text: 'Comedy gold.',
  tips: [{ title: 'Remove API key', description: 'Use .env', priority: 'high', file_path: 'config.py' }],
  author_first_name: 'Deepa',
  author_avatar_url: null,
  created_at: '2026-10-01T10:00:00Z',
  ...overrides,
});

export const makeAdminUser = (overrides: Partial<AdminUser> = {}): AdminUser => ({
  ...makeUser(),
  roast_count: 3,
  ...overrides,
});

export const makeAdminRoast = (overrides: Partial<AdminRoast> = {}): AdminRoast => ({
  ...makeRoast(),
  user_id: 1,
  user_email: 'dev@example.com',
  ...overrides,
});

export const makeStats = (overrides: Partial<AdminStats> = {}): AdminStats => ({
  total_users: 1234,
  active_users_7d: 56,
  total_roasts: 789,
  roasts_today: 12,
  avg_score: 72.4,
  failure_rate: 0.05,
  intensity_split: { mild: 100, medium: 500, extra_spicy: 189 },
  total_prompt_tokens: 1500000,
  total_completion_tokens: 250000,
  ...overrides,
});

/** Build a real AxiosError carrying an HTTP response (what services reject with). */
export const axiosError = (status: number, data: unknown = {}): AxiosError => {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', config, null, {
    status,
    statusText: String(status),
    data,
    headers: {},
    config,
  });
};

export const makeAuthValue = (overrides: Partial<AuthContextValue> = {}): AuthContextValue => ({
  user: null,
  status: 'unauthenticated',
  isAuthenticated: false,
  isAdmin: false,
  loginWithGoogle: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
  completeLogin: vi.fn(),
  refreshUser: vi.fn().mockResolvedValue(null),
  ...overrides,
});

export const authedValue = (user: User = makeUser()): AuthContextValue =>
  makeAuthValue({ user, status: 'authenticated', isAuthenticated: true, isAdmin: user.is_admin });
