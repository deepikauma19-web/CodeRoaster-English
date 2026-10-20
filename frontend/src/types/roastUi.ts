import type { RoastIntensity, ScoreBreakdown } from './roast';

export interface IntensityOption {
  value: RoastIntensity;
  chilis: string;
  label: string;
  sample: string;
}

export type ScoreCategory = keyof ScoreBreakdown;
