import { Alert, AlertDescription, AlertIcon, AlertTitle, Box, Button, Flex, Heading, SimpleGrid, Text } from '@chakra-ui/react';
import {
  FiActivity,
  FiAlertTriangle,
  FiAward,
  FiCalendar,
  FiCpu,
  FiMessageSquare,
  FiRefreshCw,
  FiUsers,
  FiZap,
} from 'react-icons/fi';
import { FailureRate, IntensitySplit, StatCard, useAbortableQuery } from '../../components/admin';
import { formatCompact, formatNumber, toPercent } from '../../components/admin/format';
import { PageWrapper } from '../../components/ui';
import { getScoreBand } from '../../lib/score';
import { getAdminStats } from '../../services/adminApi';
import type { AdminStats } from '../../types';

export default function AdminDashboardPage() {
  const { data: stats, error, isLoading, refetch: retry } = useAbortableQuery<AdminStats>(
    'admin-stats',
    getAdminStats,
  );

  const band = stats?.avg_score != null ? getScoreBand(stats.avg_score) : null;
  const show = (fn: (s: AdminStats) => string): string => (stats ? fn(stats) : '—');

  return (
    <PageWrapper maxW="container.xl">
      <Flex justify="space-between" align={{ base: 'flex-start', sm: 'center' }} mb={6} gap={3} wrap="wrap">
        <Box>
          <Heading size="lg">Admin Dashboard</Heading>
          <Text color="text.muted">Roast factory health check 🔥</Text>
        </Box>
        <Button
          leftIcon={<FiRefreshCw />}
          variant="outline"
          size="sm"
          onClick={retry}
          isLoading={isLoading && stats !== null}
        >
          Refresh
        </Button>
      </Flex>

      {error && (
        <Alert status="error" borderRadius="xl" mb={6} flexWrap="wrap" gap={2}>
          <AlertIcon />
          <Box flex="1" minW="12rem">
            <AlertTitle>Could not load stats</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Box>
          <Button size="sm" colorScheme="red" onClick={retry}>
            Retry
          </Button>
        </Alert>
      )}

      {!(error && !stats) && (
        <>
          <SimpleGrid columns={{ base: 1, sm: 2, lg: 4 }} spacing={4} mb={6}>
            <StatCard label="Total users" icon={FiUsers} isLoading={isLoading && !stats} value={show((s) => formatNumber(s.total_users))} />
            <StatCard
              label="Active (7 days)"
              icon={FiActivity}
              isLoading={isLoading && !stats}
              value={show((s) => formatNumber(s.active_users_7d))}
            />
            <StatCard label="Total roasts" icon={FiZap} isLoading={isLoading && !stats} value={show((s) => formatNumber(s.total_roasts))} />
            <StatCard
              label="Roasts today"
              icon={FiCalendar}
              isLoading={isLoading && !stats}
              value={show((s) => formatNumber(s.roasts_today))}
            />
            <StatCard
              label="Average score"
              icon={FiAward}
              isLoading={isLoading && !stats}
              value={stats?.avg_score != null ? stats.avg_score.toFixed(1) : '—'}
              helpText={band?.label ?? 'No completed roasts yet'}
              colorScheme={band?.colorScheme}
            />
            <StatCard
              label="Failure rate"
              icon={FiAlertTriangle}
              isLoading={isLoading && !stats}
              value={show((s) => `${toPercent(s.failure_rate).toFixed(1)}%`)}
            />
            <StatCard
              label="Prompt tokens"
              icon={FiCpu}
              isLoading={isLoading && !stats}
              value={show((s) => formatCompact(s.total_prompt_tokens))}
              helpText={stats ? `${formatNumber(stats.total_prompt_tokens)} total` : undefined}
            />
            <StatCard
              label="Completion tokens"
              icon={FiMessageSquare}
              isLoading={isLoading && !stats}
              value={show((s) => formatCompact(s.total_completion_tokens))}
              helpText={stats ? `${formatNumber(stats.total_completion_tokens)} total` : undefined}
            />
          </SimpleGrid>

          <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={4}>
            <IntensitySplit split={stats?.intensity_split ?? null} isLoading={isLoading && !stats} />
            <FailureRate
              rate={stats?.failure_rate ?? null}
              totalRoasts={stats?.total_roasts ?? null}
              isLoading={isLoading && !stats}
            />
          </SimpleGrid>
        </>
      )}
    </PageWrapper>
  );
}
