import { Center, Spinner, Stack, Text } from '@chakra-ui/react';

interface AuthSpinnerProps {
  label?: string;
}

/** Centered spinner shown while the auth state is resolving. */
export function AuthSpinner({ label = 'Checking your session…' }: AuthSpinnerProps) {
  return (
    <Center py={20} role="status" aria-live="polite">
      <Stack align="center" spacing={4}>
        <Spinner size="xl" color="ink.500" thickness="4px" label={label} />
        <Text color="text.muted">{label}</Text>
      </Stack>
    </Center>
  );
}

export default AuthSpinner;
