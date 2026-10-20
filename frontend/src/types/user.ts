export interface User {
  id: number;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
}
