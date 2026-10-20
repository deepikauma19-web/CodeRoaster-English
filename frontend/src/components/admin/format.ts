import axios from 'axios';
import type { RoastIntensity, RoastStatus } from '../../types';

const numberFormatter = new Intl.NumberFormat();
const compactFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export const formatNumber = (value: number): string => numberFormatter.format(value);
export const formatCompact = (value: number): string => compactFormatter.format(value);

const safeDate = (iso: string | null): Date | null => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatDate = (iso: string | null): string => {
  const date = safeDate(iso);
  return date ? dateFormatter.format(date) : '—';
};

export const formatDateTime = (iso: string | null): string => {
  const date = safeDate(iso);
  return date ? dateTimeFormatter.format(date) : '—';
};

/** Backend sends failure_rate as a 0–1 fraction; tolerate a 0–100 percentage too. */
export const toPercent = (rate: number): number => {
  const pct = rate <= 1 ? rate * 100 : rate;
  return Math.min(100, Math.max(0, pct));
};

export const INTENSITY_ORDER: readonly RoastIntensity[] = ['mild', 'medium', 'extra_spicy'];

export const INTENSITY_META: Record<RoastIntensity, { label: string; chilis: string; colorScheme: string }> = {
  mild: { label: 'Mild', chilis: '🌶️', colorScheme: 'yellow' },
  medium: { label: 'Medium', chilis: '🌶️🌶️', colorScheme: 'orange' },
  extra_spicy: { label: 'Extra Spicy', chilis: '🌶️🌶️🌶️', colorScheme: 'red' },
};

export const STATUS_OPTIONS: readonly RoastStatus[] = ['pending', 'fetching', 'analyzing', 'completed', 'failed'];

export const STATUS_META: Record<RoastStatus, { label: string; colorScheme: string }> = {
  pending: { label: 'Pending', colorScheme: 'gray' },
  fetching: { label: 'Fetching', colorScheme: 'blue' },
  analyzing: { label: 'Analyzing', colorScheme: 'purple' },
  completed: { label: 'Completed', colorScheme: 'green' },
  failed: { label: 'Failed', colorScheme: 'red' },
};

/** True when a request was aborted because filters changed / component unmounted. */
export const isAbortError = (err: unknown): boolean =>
  axios.isCancel(err) || (err instanceof DOMException && err.name === 'AbortError');

export const shareUrlFor = (slug: string): string => `${window.location.origin}/r/${slug}`;
