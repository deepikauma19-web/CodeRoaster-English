import { Box, Flex, Heading, Progress, Skeleton, Stack, Text } from '@chakra-ui/react';
import type { RoastIntensity } from '../../types';
import { GlassCard } from '../ui';
import { formatNumber, INTENSITY_META, INTENSITY_ORDER } from './format';

interface IntensitySplitProps {
  split: Record<RoastIntensity, number> | null;
  isLoading?: boolean;
}

export function IntensitySplit({ split, isLoading = false }: IntensitySplitProps) {
  const total = split ? INTENSITY_ORDER.reduce((sum, key) => sum + (split[key] ?? 0), 0) : 0;
  return (
    <GlassCard static p={6}>
      <Heading size="sm" mb={4}>
        Intensity split
      </Heading>
      <Stack spacing={4}>
        {INTENSITY_ORDER.map((key) => {
          const meta = INTENSITY_META[key];
          const count = split?.[key] ?? 0;
          const pct = total > 0 ? (count / total) * 100 : 0;
          return (
            <Box key={key}>
              <Flex justify="space-between" mb={1} fontSize="sm">
                <Text fontWeight="medium">
                  <Text as="span" mr={2} aria-hidden>
                    {meta.chilis}
                  </Text>
                  {meta.label}
                </Text>
                <Skeleton isLoaded={!isLoading}>
                  <Text color="text.muted">
                    {formatNumber(count)} ({pct.toFixed(0)}%)
                  </Text>
                </Skeleton>
              </Flex>
              <Progress
                value={isLoading ? 0 : pct}
                colorScheme={meta.colorScheme}
                borderRadius="full"
                size="sm"
                isIndeterminate={isLoading}
                aria-label={`${meta.label} roasts`}
              />
            </Box>
          );
        })}
      </Stack>
    </GlassCard>
  );
}

export default IntensitySplit;
