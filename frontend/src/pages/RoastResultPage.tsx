import {
  Alert,
  AlertDescription,
  AlertIcon,
  Box,
  Button,
  Flex,
  Heading,
  Icon,
  Link,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  useToast,
} from '@chakra-ui/react';
import { useState } from 'react';
import { FaExternalLinkAlt, FaRedo } from 'react-icons/fa';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  DeleteRoastButton,
  IntensityBadge,
  RepoMetaBar,
  RoastCard,
  RoastLoader,
  ScoreBreakdownBars,
  ScoreGauge,
  TipsList,
} from '../components/roast';
import { ShareButtons } from '../components/share/ShareButtons';
import { GlassCard, GradientButton, PageWrapper } from '../components/ui';
import { useRoastPolling } from '../hooks/useRoastPolling';
import { getErrorMessage } from '../services/api';
import { retryRoast } from '../services/roastApi';
import type { Roast } from '../types/roast';

function NotFoundState() {
  return (
    <GlassCard static textAlign="center" py={12} data-testid="roast-not-found">
      <Text fontSize="5xl" aria-hidden="true">
        🕵️
      </Text>
      <Heading as="h1" size="lg" mt={2}>
        This roast has vanished into thin air
      </Heading>
      <Text color="text.muted" mt={2} mb={6}>
        It may have been deleted, or it does not belong to you.
      </Text>
      <GradientButton to="/roast/new">New roast 🔥</GradientButton>
    </GlassCard>
  );
}

interface FailedStateProps {
  roast: Roast;
  onRetried: () => void;
  onDeleted: () => void;
}

function FailedState({ roast, onRetried, onDeleted }: FailedStateProps) {
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const toast = useToast();

  const handleRetry = async (): Promise<void> => {
    setIsRetrying(true);
    try {
      await retryRoast(roast.id);
      onRetried();
    } catch (err: unknown) {
      toast({ status: 'error', title: 'Could not retry', description: getErrorMessage(err), duration: 5000 });
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <GlassCard static borderColor="red.400" data-testid="roast-failed">
      <Stack spacing={4}>
        <Heading as="h2" size="md">
          The roast failed 😵
        </Heading>
        <Alert status="error" borderRadius="xl">
          <AlertIcon />
          <AlertDescription>{roast.error_message ?? 'Something went wrong. Please retry.'}</AlertDescription>
        </Alert>
        <Flex gap={3} wrap="wrap">
          <Button leftIcon={<FaRedo />} onClick={() => void handleRetry()} isLoading={isRetrying}>
            Retry
          </Button>
          <DeleteRoastButton roastId={roast.id} onDeleted={onDeleted} />
        </Flex>
      </Stack>
    </GlassCard>
  );
}

interface CompletedStateProps {
  roast: Roast;
  onRoastChange: (roast: Roast) => void;
  onDeleted: () => void;
}

function CompletedState({ roast, onRoastChange, onDeleted }: CompletedStateProps) {
  return (
    <Stack spacing={6} data-testid="roast-completed">
      {roast.error_message && (
        <Alert status="warning" borderRadius="xl" data-testid="roast-warning">
          <AlertIcon />
          <AlertDescription>{roast.error_message}</AlertDescription>
        </Alert>
      )}
      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={6}>
        <GlassCard static display="flex" alignItems="center" justifyContent="center">
          <ScoreGauge score={roast.overall_score ?? 0} />
        </GlassCard>
        <GlassCard static>
          <Heading as="h2" size="md" mb={4}>
            Score breakdown
          </Heading>
          {roast.score_breakdown ? (
            <ScoreBreakdownBars breakdown={roast.score_breakdown} />
          ) : (
            <Text color="text.muted">No score breakdown available.</Text>
          )}
        </GlassCard>
      </SimpleGrid>

      {roast.summary && (
        <GlassCard static>
          <Heading as="h2" size="md" mb={2}>
            TL;DR
          </Heading>
          <Text color="text.muted" fontSize={{ base: 'md', md: 'lg' }}>
            {roast.summary}
          </Text>
        </GlassCard>
      )}

      {roast.roast_text && <RoastCard markdown={roast.roast_text} />}

      <GlassCard static>
        <Heading as="h2" size="md" mb={4}>
          Fix it — tips ✅
        </Heading>
        <TipsList tips={roast.tips} interactive />
      </GlassCard>

      <GlassCard static>
        <Heading as="h2" size="md" mb={4}>
          Share the burn
        </Heading>
        <ShareButtons roast={roast} onRoastChange={onRoastChange} />
      </GlassCard>

      <Flex justify="space-between" gap={3} wrap="wrap">
        <Button as={RouterLink} to="/roast/new" variant="outline">
          Roast another 🔥
        </Button>
        <DeleteRoastButton roastId={roast.id} onDeleted={onDeleted} />
      </Flex>
    </Stack>
  );
}

export default function RoastResultPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { roast, isLoading, error, notFound, refetch, setRoast } = useRoastPolling(id);

  const handleDeleted = (): void => navigate('/roast/new');
  const handleRoastChange = (next: Roast): void => setRoast(next);

  if (notFound) {
    return (
      <PageWrapper>
        <NotFoundState />
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      {roast && (
        <Stack spacing={3} mb={8}>
          <Flex gap={3} align="center" wrap="wrap">
            <Heading as="h1" size={{ base: 'lg', md: 'xl' }} wordBreak="break-word">
              <Link href={roast.repo_url} isExternal rel="noopener noreferrer" _hover={{ color: 'accent.fire' }}>
                {roast.repo_owner}/{roast.repo_name}
                <Icon as={FaExternalLinkAlt} boxSize={4} ml={2} verticalAlign="middle" aria-hidden="true" />
              </Link>
            </Heading>
            <IntensityBadge intensity={roast.intensity} />
          </Flex>
          {roast.status === 'completed' && (
            <RepoMetaBar
              languageBreakdown={roast.language_breakdown}
              filesAnalyzed={roast.files_analyzed}
              completedAt={roast.completed_at}
            />
          )}
        </Stack>
      )}

      {error && (
        <Alert status="error" borderRadius="xl" mb={6} data-testid="roast-error">
          <AlertIcon />
          <AlertDescription flex="1">{error}</AlertDescription>
          <Button size="sm" ml={3} onClick={refetch}>
            Reload
          </Button>
        </Alert>
      )}

      {isLoading && !roast && !error && (
        <Stack spacing={4}>
          <Skeleton h="40px" w="60%" borderRadius="md" />
          <Skeleton h="200px" borderRadius="2xl" />
        </Stack>
      )}

      {roast && (roast.status === 'pending' || roast.status === 'fetching' || roast.status === 'analyzing') && !error && (
        <RoastLoader status={roast.status} />
      )}

      {roast?.status === 'failed' && (
        <FailedState roast={roast} onRetried={refetch} onDeleted={handleDeleted} />
      )}

      {roast?.status === 'completed' && (
        <CompletedState roast={roast} onRoastChange={handleRoastChange} onDeleted={handleDeleted} />
      )}

      {!roast && !isLoading && !error && (
        <Box textAlign="center" py={10}>
          <Text color="text.muted">Could not load the roast.</Text>
        </Box>
      )}
    </PageWrapper>
  );
}
