import {
  Alert,
  AlertDescription,
  AlertIcon,
  Box,
  Button,
  FormControl,
  FormLabel,
  Heading,
  Input,
  Select,
  SimpleGrid,
  Text,
  useToast,
} from '@chakra-ui/react';
import { useCallback, useState } from 'react';
import { ConfirmDialog, Pagination, RoastDetailsDrawer, RoastsTable, useAbortableQuery } from '../../components/admin';
import { shareUrlFor, STATUS_META, STATUS_OPTIONS } from '../../components/admin/format';
import { PageWrapper } from '../../components/ui';
import { deleteAdminRoast, listAdminRoasts } from '../../services/adminApi';
import { getErrorMessage } from '../../services/api';
import type { AdminRoast, Paginated, RoastStatus } from '../../types';
import type { PendingRoastDelete } from '../../types/adminUi';

const PAGE_SIZE = 20;

const isRoastStatus = (value: string): value is RoastStatus =>
  (STATUS_OPTIONS as readonly string[]).includes(value);

export default function AdminRoastsPage() {
  const toast = useToast();
  const [status, setStatus] = useState<RoastStatus | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState<AdminRoast | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingRoastDelete | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const rangeInvalid = from !== '' && to !== '' && from > to;

  const fetchRoasts = useCallback(
    (signal: AbortSignal): Promise<Paginated<AdminRoast>> =>
      listAdminRoasts(
        { status: status || undefined, from: from || undefined, to: to || undefined, page, size: PAGE_SIZE },
        signal,
      ),
    [status, from, to, page],
  );
  const { data, error, isLoading, refetch } = useAbortableQuery<Paginated<AdminRoast>>(
    `roasts|${status}|${from}|${to}|${page}`,
    fetchRoasts,
    !rangeInvalid,
  );
  const roasts = data?.items ?? [];
  const total = data?.total ?? 0;

  const handleView = useCallback((roast: AdminRoast) => {
    if (roast.status === 'completed' && roast.is_public && roast.share_slug) {
      window.open(shareUrlFor(roast.share_slug), '_blank', 'noopener,noreferrer');
      return;
    }
    setViewing(roast);
  }, []);

  const handleDeleteRequest = useCallback((roast: AdminRoast) => setPendingDelete({ roast }), []);

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      await deleteAdminRoast(pendingDelete.roast.id);
      toast({ status: 'success', title: 'Roast deleted', duration: 3000 });
      setPendingDelete(null);
      // Step back a page if we just emptied the last one.
      if (roasts.length === 1 && page > 1) setPage((p) => p - 1);
      else refetch();
    } catch (err: unknown) {
      toast({
        status: 'error',
        title: 'Delete failed',
        description: getErrorMessage(err),
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const clearFilters = (): void => {
    setStatus('');
    setFrom('');
    setTo('');
    setPage(1);
  };

  const hasFilters = status !== '' || from !== '' || to !== '';
  const target = pendingDelete?.roast;

  return (
    <PageWrapper maxW="container.xl">
      <Box mb={6}>
        <Heading size="lg">Roasts</Heading>
        <Text color="text.muted">Every repo that got grilled 🍗</Text>
      </Box>

      <SimpleGrid columns={{ base: 1, sm: 2, md: 4 }} spacing={3} mb={4} alignItems="end">
        <FormControl>
          <FormLabel fontSize="sm">Status</FormLabel>
          <Select
            value={status}
            onChange={(e) => {
              const v = e.target.value;
              setStatus(isRoastStatus(v) ? v : '');
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </Select>
        </FormControl>
        <FormControl isInvalid={rangeInvalid}>
          <FormLabel fontSize="sm">From</FormLabel>
          <Input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </FormControl>
        <FormControl isInvalid={rangeInvalid}>
          <FormLabel fontSize="sm">To</FormLabel>
          <Input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </FormControl>
        <Button variant="ghost" onClick={clearFilters} isDisabled={!hasFilters}>
          Clear filters
        </Button>
      </SimpleGrid>

      {rangeInvalid && (
        <Alert status="warning" borderRadius="xl" mb={4}>
          <AlertIcon />
          <AlertDescription>The "From" date must be before the "To" date.</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert status="error" borderRadius="xl" mb={4} gap={2} flexWrap="wrap">
          <AlertIcon />
          <AlertDescription flex="1">{error}</AlertDescription>
          <Button size="sm" colorScheme="red" onClick={refetch}>
            Retry
          </Button>
        </Alert>
      )}

      <RoastsTable roasts={roasts} isLoading={isLoading} onView={handleView} onDelete={handleDeleteRequest} />
      <Pagination page={page} size={PAGE_SIZE} total={total} onPageChange={setPage} isDisabled={isLoading} />

      <RoastDetailsDrawer roast={viewing} onClose={() => setViewing(null)} />

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title="Delete roast?"
        body={
          <Text>
            Permanently delete the roast of{' '}
            <strong>
              {target?.repo_owner}/{target?.repo_name}
            </strong>{' '}
            ({target?.user_email})? This cannot be undone.
          </Text>
        }
        confirmLabel="Delete"
        colorScheme="red"
        isLoading={isDeleting}
        onConfirm={() => void confirmDelete()}
        onClose={() => {
          if (!isDeleting) setPendingDelete(null);
        }}
      />
    </PageWrapper>
  );
}
