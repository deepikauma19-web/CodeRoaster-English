import { Alert, AlertIcon, Badge, Box, Flex, Heading, LinkBox, LinkOverlay, Skeleton, Stack, Text } from '@chakra-ui/react';
import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { getErrorMessage } from '../../services/api';
import { listRoasts } from '../../services/roastApi';
import { getScoreBand } from '../../lib/score';
import { STATUS_COLOR } from '../../lib/roastUi';
import type { Roast } from '../../types/roast';
import { IntensityBadge } from './IntensityBadge';

export interface RecentRoastsProps {
  /** How many roasts to show (first page). */
  size?: number;
}

/** The current user's latest roasts (first page of GET /roasts). */
export function RecentRoasts({ size = 5 }: RecentRoastsProps) {
  const [roasts, setRoasts] = useState<Roast[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listRoasts({ page: 1, size })
      .then((page) => {
        if (!cancelled) setRoasts(page.items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [size]);

  return (
    <Box as="section" aria-labelledby="recent-roasts-heading" data-testid="recent-roasts">
      <Heading id="recent-roasts-heading" as="h2" size="md" mb={4}>
        Your recent roasts
      </Heading>

      {isLoading && (
        <Stack spacing={3}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} h="64px" borderRadius="xl" />
          ))}
        </Stack>
      )}

      {!isLoading && error && (
        <Alert status="error" borderRadius="xl">
          <AlertIcon />
          {error}
        </Alert>
      )}

      {!isLoading && !error && roasts.length === 0 && (
        <Text color="text.muted">No roasts yet. Your code is safe... for now. Add a repo above! 🔥</Text>
      )}

      {!isLoading && !error && roasts.length > 0 && (
        <Stack spacing={3}>
          {roasts.map((roast) => (
            <LinkBox
              key={roast.id}
              as="article"
              p={4}
              borderRadius="xl"
              borderWidth="1px"
              borderColor="border.subtle"
              bg="bg.card"
              transition="border-color 0.2s"
              _hover={{ borderColor: 'brand.300' }}
            >
              <Flex gap={3} align="center" justify="space-between" wrap="wrap">
                <Box minW={0} flex="1">
                  <LinkOverlay as={RouterLink} to={`/roasts/${roast.id}`}>
                    <Text fontWeight="semibold" noOfLines={1}>
                      {roast.repo_owner}/{roast.repo_name}
                    </Text>
                  </LinkOverlay>
                  <Text fontSize="xs" color="text.muted">
                    {new Date(roast.created_at).toLocaleDateString()}
                  </Text>
                </Box>
                <Flex gap={2} align="center" wrap="wrap">
                  <IntensityBadge intensity={roast.intensity} fontSize="xs" px={2} py={0.5} />
                  {roast.status === 'completed' && roast.overall_score !== null ? (
                    <Badge
                      colorScheme={getScoreBand(roast.overall_score).colorScheme}
                      fontSize="sm"
                      borderRadius="md"
                      px={2}
                    >
                      {roast.overall_score}/100
                    </Badge>
                  ) : (
                    <Badge colorScheme={STATUS_COLOR[roast.status]} borderRadius="md" px={2}>
                      {roast.status}
                    </Badge>
                  )}
                </Flex>
              </Flex>
            </LinkBox>
          ))}
        </Stack>
      )}
    </Box>
  );
}

export default RecentRoasts;
