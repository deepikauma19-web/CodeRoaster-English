import { describe, expect, it } from 'vitest';
import { getScoreBand } from '../lib/score';

describe('getScoreBand', () => {
  it.each([
    [0, 'red'],
    [39, 'red'],
    [40, 'orange'],
    [59, 'orange'],
    [60, 'yellow'],
    [79, 'yellow'],
    [80, 'green'],
    [100, 'green'],
  ])('maps %i to %s', (score, colorScheme) => {
    expect(getScoreBand(score).colorScheme).toBe(colorScheme);
  });
});
