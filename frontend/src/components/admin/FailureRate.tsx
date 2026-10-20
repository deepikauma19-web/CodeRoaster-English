import { CircularProgress, CircularProgressLabel, Flex, Heading, Skeleton, Text } from '@chakra-ui/react';
import { GlassCard } from '../ui';
import { formatNumber, toPercent } from './format';

interface FailureRateProps {
  rate: number | null;
  totalRoasts: number | null;
  isLoading?: boolean;
}

const colorFor = (pct: number): string => {
  if (pct >= 25) return 'red.400';
  if (pct >= 10) return 'orange.400';
  return 'green.400';
};

export function FailureRate({ rate, totalRoasts, isLoading = false }: FailureRateProps) {
  const pct = rate === null ? 0 : toPercent(rate);
  const failed = totalRoasts !== null ? Math.round((pct / 100) * totalRoasts) : null;
  return (
    <GlassCard static p={6}>
      <Heading size="sm" mb={4}>
        Failure rate
      </Heading>
      <Flex align="center" gap={6}>
        <CircularProgress
          value={pct}
          size="110px"
          thickness="10px"
          color={colorFor(pct)}
          trackColor="bg.track"
          isIndeterminate={isLoading}
          aria-label="Failure rate"
        >
          {!isLoading && <CircularProgressLabel fontWeight="bold">{pct.toFixed(1)}%</CircularProgressLabel>}
        </CircularProgress>
        <Skeleton isLoaded={!isLoading}>
          <Text color="text.muted" fontSize="sm">
            {failed !== null
              ? `~${formatNumber(failed)} of ${formatNumber(totalRoasts ?? 0)} roasts failed`
              : 'No data yet'}
          </Text>
          <Text fontSize="sm" mt={1}>
            {pct >= 25 ? 'The pipeline is on fire. Not in the good way 🔥' : pct >= 10 ? 'Keep an eye on it' : 'All good 👍'}
          </Text>
        </Skeleton>
      </Flex>
    </GlassCard>
  );
}

export default FailureRate;
