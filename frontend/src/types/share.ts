// Share module contracts (PRP Module 4). Mirrors backend ShareToggleResponse.

export interface ShareToggleResult {
  is_public: boolean;
  share_slug: string | null;
  share_url: string | null;
}

export type SharePlatform = 'whatsapp' | 'linkedin' | 'x';

export interface SharePlatformLink {
  platform: SharePlatform;
  label: string;
  href: string;
}

export type ReportReason = 'owner_request' | 'harassment' | 'secrets' | 'other';

export interface ReportRoastPayload {
  reason: ReportReason;
  details?: string;
}
