import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import {
  Box,
  Flex,
  Heading,
  Icon,
  Link,
  SimpleGrid,
  Skeleton,
  SkeletonCircle,
  SkeletonText,
  Stack,
  Text,
  Wrap,
  WrapItem,
} from '@chakra-ui/react';
import { FiGithub, FiLock } from 'react-icons/fi';
import { GlassCard, GradientButton, PageWrapper } from '../components/ui';
import { IntensityBadge } from '../components/roast/IntensityBadge';
import { RoastCard } from '../components/roast/RoastCard';
import { ScoreBreakdownBars } from '../components/roast/ScoreBreakdownBars';
import { ScoreGauge } from '../components/roast/ScoreGauge';
import { TipsList } from '../components/roast/TipsList';
import { AuthorChip } from '../components/share/AuthorChip';
import { ReportRoastButton } from '../components/share/ReportRoastButton';
import { getErrorMessage } from '../services/api';
import { getPublicRoast } from '../services/shareApi';
import type { PublicRoastResponse } from '../types/roast';

const APP_TITLE = 'Code Roaster';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; roast: PublicRoastResponse };

type SettledState = Exclude<LoadState, { kind: 'loading' }>;

interface SlugResult {
  slug: string;
  state: SettledState;
}

function PublicRoastSkeleton(): JSX.Element {
  return (
    <Stack spacing={6} data-testid="public-roast-skeleton">
      <Skeleton h="32px" w={{ base: '80%', md: '50%' }} borderRadius="md" />
      <Skeleton h="24px" w="40%" borderRadius="full" />
      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={6}>
        <Flex justify="center" py={4}>
          <SkeletonCircle size="200px" />
        </Flex>
        <SkeletonText noOfLines={5} spacing={5} skeletonHeight={3} mt={6} />
      </SimpleGrid>
      <SkeletonText noOfLines={6} spacing={4} />
    </Stack>
  );
}

function RoastCta(): JSX.Element {
  return (
    <GlassCard static textAlign="center" py={{ base: 8, md: 10 }} borderColor="brand.500">
      <Stack spacing={4} align="center">
        <Heading size={{ base: 'md', md: 'lg' }}>Want a roast of your own? 😏🔥</Heading>
        <Text color="text.muted" maxW="md">
          Paste a GitHub repo link and the AI will give you a hilarious roast plus tips to fix your code.
        </Text>
        <GradientButton to="/login" size="lg" whiteSpace="normal" h="auto" py={3}>
          Want your repo roasted too? →
        </GradientButton>
      </Stack>
    </GlassCard>
  );
}

export default function PublicRoastPage(): JSX.Element {
  const { shareSlug } = useParams<{ shareSlug: string }>();
  const [result, setResult] = useState<SlugResult | null>(null);

  // Derived: a result only counts if it belongs to the current slug.
  const state: LoadState = !shareSlug
    ? { kind: 'not_found' }
    : result && result.slug === shareSlug
      ? result.state
      : { kind: 'loading' };

  useEffect(() => {
    if (!shareSlug) return undefined;
    let cancelled = false;
    getPublicRoast(shareSlug)
      .then((roast) => {
        if (!cancelled) setResult({ slug: shareSlug, state: { kind: 'ready', roast } });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const settled: SettledState =
          axios.isAxiosError(err) && err.response?.status === 404
            ? { kind: 'not_found' }
            : { kind: 'error', message: getErrorMessage(err) };
        setResult({ slug: shareSlug, state: settled });
      });
    return () => {
      cancelled = true;
    };
  }, [shareSlug]);

  let pageTitle: string | null = null;
  if (state.kind === 'ready') {
    const { repo_owner, repo_name, overall_score } = state.roast;
    const scorePart = overall_score === null ? '' : ` – ${overall_score}/100`;
    pageTitle = `${repo_owner}/${repo_name}${scorePart} | ${APP_TITLE}`;
  } else if (state.kind === 'not_found') {
    pageTitle = `Roast not found | ${APP_TITLE}`;
  }

  useEffect(() => {
    if (!pageTitle) return undefined;
    const previous = document.title;
    document.title = pageTitle;
    return () => {
      document.title = previous;
    };
  }, [pageTitle]);

  // Shared roasts are unlisted: reachable by link, never offered to search engines.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => {
      meta.remove();
    };
  }, []);

  if (state.kind === 'loading') {
    return (
      <PageWrapper>
        <PublicRoastSkeleton />
      </PageWrapper>
    );
  }

  if (state.kind === 'not_found' || state.kind === 'error') {
    const isNotFound = state.kind === 'not_found';
    return (
      <PageWrapper>
        <Stack spacing={8}>
          <Stack align="center" textAlign="center" spacing={4} py={{ base: 8, md: 12 }}>
            <Icon as={FiLock} boxSize={10} color="accent.fire" />
            <Heading size="md" data-testid="public-roast-unavailable">
              {isNotFound
                ? 'This roast is private or has been deleted'
                : 'Could not load the roast 😵'}
            </Heading>
            {!isNotFound && <Text color="text.muted">{state.message}</Text>}
          </Stack>
          <RoastCta />
        </Stack>
      </PageWrapper>
    );
  }

  const { roast } = state;
  const repoSlug = `${roast.repo_owner}/${roast.repo_name}`;

  return (
    <PageWrapper>
      <Stack spacing={{ base: 6, md: 8 }}>
        <Stack spacing={3}>
          <Link
            href={roast.repo_url}
            isExternal
            rel="noopener noreferrer"
            display="inline-flex"
            alignItems="center"
            gap={2}
            _hover={{ color: 'accent.fire' }}
            wordBreak="break-all"
          >
            <Icon as={FiGithub} boxSize={6} flexShrink={0} />
            <Heading as="h1" size={{ base: 'md', md: 'lg' }}>
              {repoSlug}
            </Heading>
          </Link>
          <Wrap spacing={3} align="center">
            <WrapItem>
              <AuthorChip firstName={roast.author_first_name} avatarUrl={roast.author_avatar_url} />
            </WrapItem>
            <WrapItem>
              <IntensityBadge intensity={roast.intensity} />
            </WrapItem>
          </Wrap>
        </Stack>

        {(roast.overall_score !== null || roast.score_breakdown) && (
          <GlassCard static>
            <SimpleGrid columns={{ base: 1, md: 2 }} spacing={{ base: 6, md: 10 }} alignItems="center">
              {roast.overall_score !== null && (
                <Flex justify="center">
                  <ScoreGauge score={roast.overall_score} />
                </Flex>
              )}
              {roast.score_breakdown && (
                <Box>
                  <ScoreBreakdownBars breakdown={roast.score_breakdown} />
                </Box>
              )}
            </SimpleGrid>
          </GlassCard>
        )}

        {roast.roast_text && <RoastCard markdown={roast.roast_text} />}

        <GlassCard static>
          <Heading as="h2" size="md" mb={4}>
            Tips to fix it 🛠️
          </Heading>
          <TipsList tips={roast.tips} interactive={false} />
        </GlassCard>

        <Flex
          justify="space-between"
          align={{ base: 'flex-start', md: 'center' }}
          direction={{ base: 'column', md: 'row' }}
          gap={2}
          data-testid="public-roast-notice"
        >
          <Text fontSize="sm" color="text.muted">
            AI-generated roast of a public GitHub repo, made for fun. It judges the code, not the person.
          </Text>
          {shareSlug && <ReportRoastButton shareSlug={shareSlug} />}
        </Flex>

        <RoastCta />
      </Stack>
    </PageWrapper>
  );
}
