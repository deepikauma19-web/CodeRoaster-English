import api from './api';
import type { PublicRoastResponse, ShareToggleRequest } from '../types/roast';
import type { ReportRoastPayload, ShareToggleResult } from '../types/share';

/** PATCH /roasts/{id}/share — toggle public visibility (auth). 409 if not completed. */
export const toggleRoastShare = async (roastId: number, isPublic: boolean): Promise<ShareToggleResult> => {
  const body: ShareToggleRequest = { is_public: isPublic };
  const { data } = await api.patch<ShareToggleResult>(`/roasts/${roastId}/share`, body);
  return data;
};

/** GET /public/roasts/{slug} — public roast view (no auth). 404 when not public. */
export const getPublicRoast = async (shareSlug: string): Promise<PublicRoastResponse> => {
  const { data } = await api.get<PublicRoastResponse>(`/public/roasts/${encodeURIComponent(shareSlug)}`);
  return data;
};

/** POST /public/roasts/{slug}/report — flag a public roast (no auth). */
export const reportPublicRoast = async (shareSlug: string, payload: ReportRoastPayload): Promise<void> => {
  await api.post(`/public/roasts/${encodeURIComponent(shareSlug)}/report`, payload);
};

/** Absolute API origin. Links that leave the app (READMEs, social posts) must never be relative. */
const apiOrigin = (): string => import.meta.env.VITE_API_URL || window.location.origin;

/** Public SVG score badge for a shared roast, for embedding in a README. */
export const buildBadgeUrl = (shareSlug: string): string =>
  `${apiOrigin()}/api/v1/public/roasts/${encodeURIComponent(shareSlug)}/badge.svg`;

/** Markdown snippet: the badge image linking to the shared roast. */
export const buildBadgeMarkdown = (shareSlug: string, shareUrl: string): string =>
  `[![Code Roaster score](${buildBadgeUrl(shareSlug)})](${shareUrl})`;

/** Backend OG-tag share page that redirects to /r/:slug — this is the URL people share. */
export const buildShareUrl = (shareSlug: string): string =>
  `${apiOrigin()}/api/v1/public/share/${encodeURIComponent(shareSlug)}`;
