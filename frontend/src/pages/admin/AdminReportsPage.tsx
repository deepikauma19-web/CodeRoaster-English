import {
  Alert,
  AlertDescription,
  AlertIcon,
  Badge,
  Box,
  Button,
  Heading,
  Table,
  TableContainer,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  useToast,
} from '@chakra-ui/react';
import { useCallback, useState } from 'react';
import { Pagination, TableSkeletonRows, useAbortableQuery } from '../../components/admin';
import { formatDateTime } from '../../components/admin/format';
import { PageWrapper } from '../../components/ui';
import { listAdminReports, setAdminRoastSharingBlocked } from '../../services/adminApi';
import { getErrorMessage } from '../../services/api';
import type { AdminReport, Paginated } from '../../types';

const PAGE_SIZE = 20;

const REASON_LABEL: Record<string, string> = {
  owner_request: 'Owner request',
  harassment: 'Harassment',
  secrets: 'Exposed secret',
  other: 'Other',
};

export default function AdminReportsPage() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<number | null>(null);

  const fetchReports = useCallback(
    (signal: AbortSignal): Promise<Paginated<AdminReport>> => listAdminReports({ page, size: PAGE_SIZE }, signal),
    [page],
  );
  const { data, error, isLoading, refetch } = useAbortableQuery<Paginated<AdminReport>>(
    `reports|${page}`,
    fetchReports,
  );
  const reports = data?.items ?? [];
  const total = data?.total ?? 0;

  const handleToggle = async (report: AdminReport): Promise<void> => {
    const blocked = !report.share_blocked;
    setBusyId(report.id);
    try {
      await setAdminRoastSharingBlocked(report.roast_id, blocked);
      toast({ status: 'success', title: blocked ? 'Sharing blocked' : 'Sharing allowed again', duration: 3000 });
      refetch();
    } catch (err: unknown) {
      toast({
        status: 'error',
        title: 'Update failed',
        description: getErrorMessage(err),
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PageWrapper maxW="container.xl">
      <Box mb={6}>
        <Heading size="lg">Reports</Heading>
        <Text color="text.muted">Shared roasts people have flagged. Roasts are hidden automatically after repeat reports.</Text>
      </Box>

      {error && (
        <Alert status="error" borderRadius="xl" mb={4} gap={2} flexWrap="wrap">
          <AlertIcon />
          <AlertDescription flex="1">{error}</AlertDescription>
          <Button size="sm" colorScheme="red" onClick={refetch}>
            Retry
          </Button>
        </Alert>
      )}

      <TableContainer borderWidth="1px" borderColor="border.subtle" borderRadius="xl" bg="bg.card">
        <Table size="sm">
          <Thead>
            <Tr>
              <Th>Repo</Th>
              <Th>Reason</Th>
              <Th>Details</Th>
              <Th isNumeric>Reports</Th>
              <Th>Reported</Th>
              <Th>Sharing</Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {isLoading ? (
              <TableSkeletonRows rows={5} columns={7} />
            ) : reports.length === 0 ? (
              <Tr>
                <Td colSpan={7} textAlign="center" py={10} color="text.muted">
                  No reports. All quiet 🕊️
                </Td>
              </Tr>
            ) : (
              reports.map((report) => (
                <Tr key={report.id}>
                  <Td fontWeight="medium">
                    {report.repo_owner}/{report.repo_name}
                  </Td>
                  <Td>{REASON_LABEL[report.reason] ?? report.reason}</Td>
                  <Td maxW="xs" whiteSpace="normal">
                    {report.details ?? '—'}
                  </Td>
                  <Td isNumeric>{report.report_count}</Td>
                  <Td>{formatDateTime(report.created_at)}</Td>
                  <Td>
                    {report.share_blocked ? (
                      <Badge colorScheme="red">Blocked</Badge>
                    ) : report.is_public ? (
                      <Badge colorScheme="green">Public</Badge>
                    ) : (
                      <Badge>Private</Badge>
                    )}
                  </Td>
                  <Td>
                    <Button
                      size="xs"
                      variant="outline"
                      isLoading={busyId === report.id}
                      onClick={() => {
                        void handleToggle(report);
                      }}
                    >
                      {report.share_blocked ? 'Allow sharing' : 'Block sharing'}
                    </Button>
                  </Td>
                </Tr>
              ))
            )}
          </Tbody>
        </Table>
      </TableContainer>
      <Pagination page={page} size={PAGE_SIZE} total={total} onPageChange={setPage} isDisabled={isLoading} />
    </PageWrapper>
  );
}
