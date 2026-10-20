import {
  Alert,
  AlertDescription,
  AlertIcon,
  Box,
  Button,
  Heading,
  Input,
  InputGroup,
  InputLeftElement,
  Text,
  useToast,
} from '@chakra-ui/react';
import axios from 'axios';
import { useCallback, useState } from 'react';
import { FiSearch } from 'react-icons/fi';
import { ConfirmDialog, Pagination, UsersTable, useAbortableQuery, useDebouncedValue } from '../../components/admin';
import { PageWrapper } from '../../components/ui';
import { listAdminUsers, updateAdminUser } from '../../services/adminApi';
import { getErrorMessage } from '../../services/api';
import type { AdminUser, Paginated } from '../../types';
import type { PendingUserChange } from '../../types/adminUi';

const PAGE_SIZE = 20;

const describeChange = ({ field, value }: PendingUserChange): { title: string; action: string } => {
  if (field === 'is_active') {
    return value
      ? { title: 'Activate user?', action: 'Activate' }
      : { title: 'Deactivate user?', action: 'Deactivate' };
  }
  return value ? { title: 'Grant admin?', action: 'Make admin' } : { title: 'Remove admin?', action: 'Remove admin' };
};

export default function AdminUsersPage() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  // Page is tied to the search term it was chosen for, so a new search resets to page 1.
  const [pageState, setPageState] = useState<{ search: string; page: number }>({ search: '', page: 1 });
  const page = pageState.search === debouncedSearch ? pageState.page : 1;
  const setPage = useCallback(
    (next: number) => setPageState({ search: debouncedSearch, page: next }),
    [debouncedSearch],
  );
  const [pending, setPending] = useState<PendingUserChange | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const fetchUsers = useCallback(
    (signal: AbortSignal): Promise<Paginated<AdminUser>> =>
      listAdminUsers({ search: debouncedSearch || undefined, page, size: PAGE_SIZE }, signal),
    [debouncedSearch, page],
  );
  const {
    data,
    error,
    isLoading,
    refetch: retry,
    setData,
  } = useAbortableQuery<Paginated<AdminUser>>(`users|${debouncedSearch}|${page}`, fetchUsers);
  const users = data?.items ?? [];
  const total = data?.total ?? 0;

  const handleToggle = useCallback((user: AdminUser, field: PendingUserChange['field'], value: boolean) => {
    setPending({ user, field, value });
  }, []);

  const closeDialog = useCallback(() => {
    if (!isSaving) setPending(null);
  }, [isSaving]);

  const confirmChange = async (): Promise<void> => {
    if (!pending) return;
    setIsSaving(true);
    try {
      const updated = await updateAdminUser(pending.user.id, { [pending.field]: pending.value });
      setData((prev) =>
        prev ? { ...prev, items: prev.items.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)) } : prev,
      );
      toast({ status: 'success', title: 'User updated', description: updated.email, duration: 3000 });
      setPending(null);
    } catch (err: unknown) {
      const conflict = axios.isAxiosError(err) && err.response?.status === 409;
      toast({
        status: conflict ? 'warning' : 'error',
        title: conflict ? 'Not allowed' : 'Update failed',
        description: getErrorMessage(err),
        duration: 5000,
        isClosable: true,
      });
      setPending(null);
    } finally {
      setIsSaving(false);
    }
  };

  const copy = pending ? describeChange(pending) : null;
  const pendingName = pending ? (pending.user.full_name ?? pending.user.email) : '';

  return (
    <PageWrapper maxW="container.xl">
      <Box mb={6}>
        <Heading size="lg">Users</Heading>
        <Text color="text.muted">See who has been roasting 👀</Text>
      </Box>

      <InputGroup mb={4} maxW={{ base: 'full', md: 'sm' }}>
        <InputLeftElement pointerEvents="none">
          <FiSearch />
        </InputLeftElement>
        <Input
          placeholder="Search name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search users"
        />
      </InputGroup>

      {error && (
        <Alert status="error" borderRadius="xl" mb={4} gap={2} flexWrap="wrap">
          <AlertIcon />
          <AlertDescription flex="1">{error}</AlertDescription>
          <Button size="sm" colorScheme="red" onClick={retry}>
            Retry
          </Button>
        </Alert>
      )}

      <UsersTable
        users={users}
        isLoading={isLoading}
        busyUserId={isSaving && pending ? pending.user.id : null}
        onToggle={handleToggle}
      />
      <Pagination page={page} size={PAGE_SIZE} total={total} onPageChange={setPage} isDisabled={isLoading} />

      <ConfirmDialog
        isOpen={pending !== null}
        title={copy?.title ?? ''}
        body={
          <Text>
            {copy?.action} <strong>{pendingName}</strong>? This takes effect immediately.
          </Text>
        }
        confirmLabel={copy?.action}
        colorScheme={pending && !pending.value ? 'red' : 'brand'}
        isLoading={isSaving}
        onConfirm={() => void confirmChange()}
        onClose={closeDialog}
      />
    </PageWrapper>
  );
}
