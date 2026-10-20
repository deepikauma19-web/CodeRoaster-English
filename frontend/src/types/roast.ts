// Mirrors backend Pydantic schemas (PRP: SHARED CONTRACTS). Keep in sync.

export type RoastIntensity = 'mild' | 'medium' | 'extra_spicy';

export type RoastStatus = 'pending' | 'fetching' | 'analyzing' | 'completed' | 'failed';

export type TipPriority = 'high' | 'medium' | 'low';

export interface RoastCreate {
  repo_url: string;
  intensity?: RoastIntensity;
}

export interface Tip {
  title: string;
  description: string;
  priority: TipPriority;
  file_path: string | null;
}

export interface ScoreBreakdown {
  code_quality: number;
  structure: number;
  documentation: number;
  ai_best_practices: number;
  security: number;
}

/** Language name -> percentage, e.g. { "Python": 82.1 } */
export type LanguageBreakdown = Record<string, number>;

/** Owner view of a roast (backend RoastResponse). */
export interface Roast {
  id: number;
  repo_url: string;
  repo_owner: string;
  repo_name: string;
  intensity: RoastIntensity;
  status: RoastStatus;
  overall_score: number | null;
  score_breakdown: ScoreBreakdown | null;
  roast_text: string | null;
  summary: string | null;
  tips: Tip[];
  files_analyzed: number;
  language_breakdown: LanguageBreakdown | null;
  error_message: string | null;
  is_public: boolean;
  share_slug: string | null;
  secrets_detected: number;
  share_blocked: boolean;
  created_at: string;
  completed_at: string | null;
}

export interface RoastQuota {
  /** null = unlimited (admins, or the limit is switched off). */
  limit: number | null;
  used: number;
  remaining: number | null;
  /** When one more roast becomes available; null if the user is not at the limit. */
  resets_at: string | null;
}

export type RoastResponse = Roast;

export interface RoastStatusResponse {
  id: number;
  status: RoastStatus;
  error_message: string | null;
}

/** Public share view — no email, no user_id, no id. */
export interface PublicRoastResponse {
  repo_owner: string;
  repo_name: string;
  repo_url: string;
  intensity: RoastIntensity;
  overall_score: number | null;
  score_breakdown: ScoreBreakdown | null;
  roast_text: string | null;
  tips: Tip[];
  author_first_name: string | null;
  author_avatar_url: string | null;
  created_at: string;
}

export interface ShareToggleRequest {
  is_public: boolean;
}

export interface ShareToggleResponse {
  is_public: boolean;
  share_url: string | null;
}

export const TERMINAL_ROAST_STATUSES: readonly RoastStatus[] = ['completed', 'failed'];
