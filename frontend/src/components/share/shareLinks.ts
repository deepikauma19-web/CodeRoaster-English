import type { SharePlatformLink } from '../../types/share';

/** Share blurb used by WhatsApp / X. */
export const buildShareText = (score: number | null): string => {
  const scorePart = score === null ? '' : ` Score: ${score}/100`;
  return `My code just got roasted 😭🔥${scorePart}`;
};

export const buildPlatformLinks = (shareUrl: string, text: string): SharePlatformLink[] => {
  const url = encodeURIComponent(shareUrl);
  return [
    {
      platform: 'whatsapp',
      label: 'WhatsApp',
      href: `https://wa.me/?text=${encodeURIComponent(`${text} ${shareUrl}`)}`,
    },
    {
      platform: 'linkedin',
      label: 'LinkedIn',
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
    },
    {
      platform: 'x',
      label: 'X',
      href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${url}`,
    },
  ];
};

/** Copy via the async Clipboard API. Returns false when unavailable/denied so callers can fall back. */
export const copyWithClipboardApi = async (text: string): Promise<boolean> => {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};
