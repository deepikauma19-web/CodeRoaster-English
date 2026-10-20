import { Heading, Stack, Text } from '@chakra-ui/react';
import { GradientButton, PageWrapper } from '../components/ui';

export default function NotFoundPage() {
  return (
    <PageWrapper>
      <Stack align="center" textAlign="center" spacing={4} py={16}>
        <Heading size="2xl">404</Heading>
        <Heading size="md">This page does not exist. Like your unit tests.</Heading>
        <Text color="text.muted">The page you are looking for does not exist.</Text>
        <GradientButton to="/">
          Go home
        </GradientButton>
      </Stack>
    </PageWrapper>
  );
}
