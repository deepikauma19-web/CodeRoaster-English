import { AxiosError } from 'axios';
import { afterEach, describe, expect, it } from 'vitest';
import { formatCompact, formatDate, formatDateTime, isAbortError, toPercent } from '../components/admin/format';
import { buildPlatformLinks, buildShareText, copyWithClipboardApi } from '../components/share/shareLinks';
import { getIntensityOption, isTerminalStatus, isValidRepoUrl } from '../lib/roastUi';
import { getScoreBand } from '../lib/score';
import { getErrorMessage } from '../services/api';
import {
  consumePostLoginPath,
  DEFAULT_POST_LOGIN_PATH,
  POST_LOGIN_REDIRECT_KEY,
  savePostLoginPath,
} from '../services/authService';
import { buildShareUrl } from '../services/shareApi';
import { axiosError } from './utils/fixtures';

describe('getScoreBand labels', () => {
  it.each([
    [0, 'Burnt 🔥'],
    [39, 'Burnt 🔥'],
    [40, 'Half-boiled'],
    [59, 'Half-boiled'],
    [60, 'Decent'],
    [79, 'Decent'],
    [80, 'Excellent! 🏆'],
    [100, 'Excellent! 🏆'],
  ])('score %i → %s', (score, label) => {
    expect(getScoreBand(score).label).toBe(label);
  });
});

describe('isValidRepoUrl', () => {
  it.each([
    ['https://github.com/owner/repo', true],
    ['https://github.com/owner/repo/', true],
    ['  https://github.com/owner/repo  ', true],
    ['https://github.com/my-org/my.repo_name-2', true],
    ['http://github.com/owner/repo', false],
    ['https://gitlab.com/owner/repo', false],
    ['https://github.com/owner', false],
    ['https://github.com/owner/repo/tree/main', false],
    ['https://github.com.evil.com/owner/repo', false],
    ['https://github.com/owner/repo?x=1', false],
    ['github.com/owner/repo', false],
    ['', false],
    ['javascript:alert(1)', false],
  ])('%j → %s', (url, expected) => {
    expect(isValidRepoUrl(url)).toBe(expected);
  });
});

describe('roastUi helpers', () => {
  it('isTerminalStatus only for completed/failed', () => {
    expect(isTerminalStatus('completed')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('pending')).toBe(false);
    expect(isTerminalStatus('fetching')).toBe(false);
    expect(isTerminalStatus('analyzing')).toBe(false);
  });

  it('getIntensityOption returns the matching option', () => {
    expect(getIntensityOption('extra_spicy').label).toBe('Extra Spicy');
    expect(getIntensityOption('mild').chilis).toBe('🌶️');
  });
});

describe('shareLinks', () => {
  const url = 'https://api.example.com/api/v1/public/share/abc?x=1&y=2';

  it('buildShareText includes score when present', () => {
    expect(buildShareText(72)).toContain('Score: 72/100');
    expect(buildShareText(null)).not.toContain('Score');
  });

  it('buildPlatformLinks encodes the share URL for every platform', () => {
    const links = buildPlatformLinks(url, 'hi there');
    expect(links.map((l) => l.platform)).toEqual(['whatsapp', 'linkedin', 'x']);
    const encoded = encodeURIComponent(url);
    expect(links[0].href).toBe(`https://wa.me/?text=${encodeURIComponent(`hi there ${url}`)}`);
    expect(links[1].href).toBe(`https://www.linkedin.com/sharing/share-offsite/?url=${encoded}`);
    expect(links[2].href).toBe(`https://twitter.com/intent/tweet?text=hi%20there&url=${encoded}`);
    for (const link of links) expect(link.href).not.toContain('&y=2');
  });

  it('copyWithClipboardApi returns false when writeText rejects', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    });
    await expect(copyWithClipboardApi('x')).resolves.toBe(false);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
    await expect(copyWithClipboardApi('x')).resolves.toBe(true);
    if (original) Object.defineProperty(navigator, 'clipboard', original);
  });

  it('buildShareUrl encodes the slug', () => {
    expect(buildShareUrl('a b')).toMatch(/\/api\/v1\/public\/share\/a%20b$/);
  });
});

describe('getErrorMessage', () => {
  it('uses string detail', () => {
    expect(getErrorMessage(axiosError(409, { detail: 'Nope' }))).toBe('Nope');
  });
  it('joins validation detail arrays', () => {
    expect(getErrorMessage(axiosError(422, { detail: [{ msg: 'bad url' }, {}] }))).toBe('bad url, Invalid input');
  });
  it('uses message field', () => {
    expect(getErrorMessage(axiosError(500, { message: 'boom' }))).toBe('boom');
  });
  it('falls back to axios message when body has no detail', () => {
    expect(getErrorMessage(axiosError(500, {}))).toBe('Request failed with status code 500');
  });
  it('handles network errors (no response)', () => {
    expect(getErrorMessage(new AxiosError('Network Error'))).toMatch(/check your network/);
  });
  it('handles Error, string and unknown values', () => {
    expect(getErrorMessage(new Error('plain'))).toBe('plain');
    expect(getErrorMessage('text')).toBe('text');
    expect(getErrorMessage(42)).toMatch(/Something went wrong/);
  });
});

describe('post-login redirect storage', () => {
  afterEach(() => window.sessionStorage.clear());

  it('round-trips a safe internal path and clears it', () => {
    savePostLoginPath('/roasts/5?x=1');
    expect(window.sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY)).toBe('/roasts/5?x=1');
    expect(consumePostLoginPath()).toBe('/roasts/5?x=1');
    expect(consumePostLoginPath()).toBe(DEFAULT_POST_LOGIN_PATH);
  });

  it.each(['//evil.com', '/\\evil.com', 'https://evil.com', '/login', '/auth/callback'])(
    'refuses to save %s',
    (path) => {
      savePostLoginPath(path);
      expect(window.sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY)).toBeNull();
    },
  );

  it('ignores a tampered stored value', () => {
    window.sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, '//evil.com');
    expect(consumePostLoginPath()).toBe(DEFAULT_POST_LOGIN_PATH);
  });
});

describe('admin format helpers', () => {
  it('toPercent tolerates fractions and percentages and clamps', () => {
    expect(toPercent(0.25)).toBe(25);
    expect(toPercent(40)).toBe(40);
    expect(toPercent(250)).toBe(100);
    expect(toPercent(-1)).toBe(0);
  });
  it('formatDate / formatDateTime return a dash for empty or invalid input', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('—');
    expect(formatDate('2026-01-02T00:00:00Z')).not.toBe('—');
  });
  it('formatCompact shortens big numbers', () => {
    expect(formatCompact(1500000)).toMatch(/1\.5/);
  });
  it('isAbortError detects DOM aborts and axios cancels', () => {
    expect(isAbortError(new DOMException('x', 'AbortError'))).toBe(true);
    expect(isAbortError(new Error('x'))).toBe(false);
  });
});
