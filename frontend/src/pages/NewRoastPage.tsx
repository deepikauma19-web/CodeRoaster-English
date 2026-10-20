import { Alert, AlertDescription, AlertIcon, Box, Divider, FormLabel, Heading, Stack, Text, chakra } from '@chakra-ui/react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { GlassCard, PageWrapper } from '../components/ui';
import { IntensityPicker, RecentRoasts, RepoUrlInput, RoastMeButton } from '../components/roast';
import { useRoastQuota } from '../hooks/useRoastQuota';
import { DEFAULT_INTENSITY, isValidRepoUrl } from '../lib/roastUi';
import { getErrorMessage } from '../services/api';
import { createRoast } from '../services/roastApi';
import type { RoastIntensity } from '../types/roast';

const INVALID_URL_MESSAGE = 'Enter a valid GitHub repo URL, e.g. https://github.com/owner/repo';

const formatReset = (iso: string | null): string => {
  if (!iso) return 'later today';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? 'later today'
    : date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

export default function NewRoastPage() {
  const navigate = useNavigate();
  const { quota, refresh: refreshQuota } = useRoastQuota();
  const outOfRoasts = quota?.remaining === 0;
  const [repoUrl, setRepoUrl] = useState<string>('');
  const [intensity, setIntensity] = useState<RoastIntensity>(DEFAULT_INTENSITY);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [touched, setTouched] = useState<boolean>(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const validate = (value: string): string | null => {
    if (!value.trim()) return 'Please enter a repo URL!';
    return isValidRepoUrl(value) ? null : INVALID_URL_MESSAGE;
  };

  const handleUrlChange = (value: string): void => {
    setRepoUrl(value);
    setServerError(null);
    if (touched) setUrlError(validate(value));
  };

  const handleBlur = (): void => {
    if (!repoUrl) return;
    setTouched(true);
    setUrlError(validate(repoUrl));
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setTouched(true);
    const validation = validate(repoUrl);
    setUrlError(validation);
    if (validation || outOfRoasts) return;

    setIsSubmitting(true);
    setServerError(null);
    try {
      const roast = await createRoast({ repo_url: repoUrl.trim(), intensity });
      navigate(`/roasts/${roast.id}`);
    } catch (err: unknown) {
      setServerError(getErrorMessage(err));
      setIsSubmitting(false);
      void refreshQuota();
    }
  };

  return (
    <PageWrapper maxW="container.md">
      <Stack spacing={2} mb={8} textAlign={{ base: 'left', md: 'center' }}>
        <Heading as="h1" size={{ base: 'xl', md: '2xl' }} fontFamily="display">
          Ready to get your repo{' '}
          <chakra.span bg="brand.400" px={2} borderRadius="md">
            roasted
          </chakra.span>
          ? 🔥
        </Heading>
        <Text color="text.muted" fontSize={{ base: 'md', md: 'lg' }}>
          Paste a public GitHub repo link and choose a spice level. You will get a roast, a score and tips to fix your code.
        </Text>
      </Stack>

      <GlassCard static>
        <chakra.form onSubmit={(e: FormEvent<HTMLFormElement>) => void handleSubmit(e)} noValidate>
          <Stack spacing={6}>
            <RepoUrlInput
              value={repoUrl}
              onChange={handleUrlChange}
              onBlur={handleBlur}
              error={urlError}
              isDisabled={isSubmitting}
            />

            <Box>
              <FormLabel as="p" mb={3}>
                Spice level
              </FormLabel>
              <IntensityPicker value={intensity} onChange={setIntensity} isDisabled={isSubmitting} />
            </Box>

            {serverError && (
              <Alert status="error" borderRadius="xl" data-testid="server-error">
                <AlertIcon />
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}

            {outOfRoasts && (
              <Alert status="warning" borderRadius="xl" data-testid="quota-exhausted">
                <AlertIcon />
                <AlertDescription>
                  You have used all {quota?.limit} roasts for today. Your next one is available around{' '}
                  {formatReset(quota?.resets_at ?? null)}.
                </AlertDescription>
              </Alert>
            )}

            <Stack align="center" spacing={2}>
              <RoastMeButton isLoading={isSubmitting} isDisabled={outOfRoasts} />
              {quota?.remaining != null && quota.remaining > 0 && (
                <Text fontSize="sm" color="text.muted" data-testid="quota-remaining">
                  {quota.remaining} of {quota.limit} roasts left today
                </Text>
              )}
            </Stack>
          </Stack>
        </chakra.form>
      </GlassCard>

      <Divider my={10} borderColor="border.subtle" />

      <RecentRoasts />
    </PageWrapper>
  );
}
