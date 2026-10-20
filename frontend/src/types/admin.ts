import type { Roast, RoastIntensity, RoastStatus } from './roast';
import type { User } from './user';

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

export interface AdminStats {
  total_users: number;
  active_users_7d: number;
  total_roasts: number;
  roasts_today: number;
  avg_score: number | null;
  failure_rate: number;
  intensity_split: Record<RoastIntensity, number>;
  total_prompt_tokens: number;
  total_completion_tokens: number;
}

export interface AdminUser extends User {
  roast_count: number;
}

export interface AdminUserUpdate {
  is_active?: boolean;
  is_admin?: boolean;
}

export interface AdminRoast extends Roast {
  user_id: number;
  user_email: string;
}

export interface AdminReport {
  id: number;
  roast_id: number;
  repo_owner: string;
  repo_name: string;
  reason: string;
  details: string | null;
  is_public: boolean;
  share_blocked: boolean;
  report_count: number;
  created_at: string;
}

export interface AdminUsersQuery {
  search?: string;
  page?: number;
  size?: number;
}

export interface AdminRoastsQuery {
  status?: RoastStatus;
  user_id?: number;
  from?: string;
  to?: string;
  page?: number;
  size?: number;
}
