import { Avatar, Badge, Button, Divider, Heading, HStack, Stack, Text, useToast } from '@chakra-ui/react';
import { useState } from 'react';
import { FiLogOut, FiShield } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { AuthSpinner } from '../components/auth/AuthSpinner';
import { GlassCard, PageWrapper } from '../components/ui';
import { useAuth } from '../hooks/useAuth';

const formatDate = (iso: string | null): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
};

export default function ProfilePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [loggingOut, setLoggingOut] = useState(false);

  if (!user) return <AuthSpinner />;

  const displayName = user.full_name ?? user.email;

  const handleLogout = async (): Promise<void> => {
    setLoggingOut(true);
    try {
      await logout();
      toast({ title: 'Logged out. Come back soon! 👋', status: 'success', duration: 3000 });
      navigate('/login', { replace: true });
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <PageWrapper maxW="container.sm">
      <GlassCard static>
        <Stack spacing={6} align="center" textAlign="center">
          <Avatar size="2xl" name={displayName} src={user.avatar_url ?? undefined} />
          <Stack spacing={1} align="center">
            <HStack spacing={2}>
              <Heading as="h1" size="lg">
                {displayName}
              </Heading>
              {user.is_admin && (
                <Badge colorScheme="purple" display="inline-flex" alignItems="center" gap={1}>
                  <FiShield aria-hidden="true" /> Admin
                </Badge>
              )}
            </HStack>
            <Text color="text.muted">{user.email}</Text>
          </Stack>
          <Divider borderColor="border.subtle" />
          <Stack spacing={2} w="full">
            <HStack justify="space-between">
              <Text color="text.muted">Member since</Text>
              <Text fontWeight="medium">{formatDate(user.created_at)}</Text>
            </HStack>
            <HStack justify="space-between">
              <Text color="text.muted">Last login</Text>
              <Text fontWeight="medium">{formatDate(user.last_login_at)}</Text>
            </HStack>
          </Stack>
          <Button
            leftIcon={<FiLogOut />}
            variant="outline"
            colorScheme="red"
            onClick={() => void handleLogout()}
            isLoading={loggingOut}
            loadingText="Logging out…"
          >
            Logout
          </Button>
        </Stack>
      </GlassCard>
    </PageWrapper>
  );
}
