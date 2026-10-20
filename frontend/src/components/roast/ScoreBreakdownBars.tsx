import { Box, Flex, Progress, Stack, Text } from '@chakra-ui/react';
import { CATEGORY_MAX, getScoreBand } from '../../lib/score';
import { SCORE_CATEGORIES } from '../../lib/roastUi';
import type { ScoreBreakdown } from '../../types/roast';

export interface ScoreBreakdownBarsProps {
  breakdown: ScoreBreakdown;
}

/** Five category bars, each out of 20. Pure presentational. */
export function ScoreBreakdownBars({ breakdown }: ScoreBreakdownBarsProps) {
  return (
    <Stack spacing={4} data-testid="score-breakdown">
      {SCORE_CATEGORIES.map(({ key, label }) => {
        const value = Math.min(CATEGORY_MAX, Math.max(0, breakdown[key]));
        const pct = (value / CATEGORY_MAX) * 100;
        const band = getScoreBand(pct);
        return (
          <Box key={key}>
            <Flex justify="space-between" mb={1}>
              <Text fontSize="sm" fontWeight="medium">
                {label}
              </Text>
              <Text fontSize="sm" color="text.muted" fontFamily="mono">
                {value}/{CATEGORY_MAX}
              </Text>
            </Flex>
            <Progress
              value={pct}
              colorScheme={band.colorScheme}
              size="sm"
              borderRadius="full"
              bg="bg.track"
              aria-label={`${label}: ${value} out of ${CATEGORY_MAX}`}
            />
          </Box>
        );
      })}
    </Stack>
  );
}

export default ScoreBreakdownBars;
