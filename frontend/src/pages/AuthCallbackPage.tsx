import { Alert, AlertDescription, AlertIcon, Button, Heading, Stack, Text } from '@chakra-ui/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthSpinner } from '../components/auth/AuthSpinner';
import { GlassCard, PageWrapper } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { consumePostLoginPath } from '../services/authService';
import type { OAuthErrorCode } from '../types/auth';

type CallbackErrorCode = OAuthErrorCode | 'missing_token' | 'unknown';

interface ParsedCallback {
  accessToken: string | null;
  error: CallbackErrorCode | null;
}

const KNOWN_ERRORS: readonly OAuthErrorCode[] = ['invalid_state', 'oauth_failed', 'account_deactivated'];

const ERROR_MESSAGES: Record<CallbackErrorCode, { title: string; description: string }> = {
  invalid_state: {
    title: 'Session timed out ⏳',
    description: 'Your login session expired or was tampered with. Please try again.',
  },
  oauth_failed: {
    title: 'Could not reach Google 😵',
    description: "We couldn't complete Google sign-in. Please try again in a little while.",
  },
  account_deactivated: {
    title: 'Account deactivated 🚫',
    description: 'Your account has been deactivated. Contact an admin if you think this is a mistake.',
  },
  missing_token: {
    title: 'Login details missing 🤔',
    description: 'No login token was found in the callback. Please sign in again.',
  },
  unknown: {
    title: 'Something went wrong 😬',
    description: 'Something went wrong while signing you in. Please try again.',
  },
};

const parseCallbackHash = (hash: string): ParsedCallback => {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const accessToken = params.get('access_token');
  const errorParam = params.get('error');
  if (errorParam) {
    const known = KNOWN_ERRORS.find((code) => code === errorParam);
    return { accessToken: null, error: known ?? 'unknown' };
  }
  if (!accessToken) return { accessToken: null, error: 'missing_token' };
  return { accessToken, error: null };
};

/** Clear the token from the address bar/history without triggering navigation. */
const clearHash = (): void => {
  try {
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
  } catch {
    // Ignore: worst case the fragment stays visible until the next navigation.
  }
};

export default function AuthCallbackPage() {
  const { completeLogin, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  // Parse once per mount (state initializer is pure, safe under StrictMode).
  const [parsed] = useState<ParsedCallback>(() => parseCallbackHash(window.location.hash));
  const [error, setError] = useState<CallbackErrorCode | null>(parsed.error);
  // StrictMode runs effects twice; make sure the token is consumed only once.
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;
    clearHash();

    const token = parsed.accessToken;
    if (!token) return;

    const finish = async (): Promise<void> => {
      try {
        await completeLogin(token);
        navigate(consumePostLoginPath(), { replace: true });
      } catch {
        setError('oauth_failed');
      }
    };
    void finish();
  }, [completeLogin, navigate, parsed.accessToken]);

  if (!error) {
    return <AuthSpinner label="Signing you in… hang tight 🔥" />;
  }

  const message = ERROR_MESSAGES[error];
  return (
    <PageWrapper maxW="container.sm">
      <GlassCard static>
        <Stack spacing={5} textAlign="center" align="center">
          <Heading as="h1" size="lg">
            {message.title}
          </Heading>
          <Alert status="error" borderRadius="lg" variant="subtle">
            <AlertIcon />
            <AlertDescription>{message.description}</AlertDescription>
          </Alert>
          <Stack direction={{ base: 'column', sm: 'row' }} spacing={3}>
            {error !== 'account_deactivated' && <Button onClick={loginWithGoogle}>Try again</Button>}
            <Button variant="ghost" onClick={() => navigate('/login', { replace: true })}>
              Back to login
            </Button>
          </Stack>
          <Text fontSize="xs" color="text.muted">
            Error code: {error}
          </Text>
        </Stack>
      </GlassCard>
    </PageWrapper>
  );
}
