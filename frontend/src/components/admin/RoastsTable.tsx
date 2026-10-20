import {
  Badge,
  HStack,
  IconButton,
  Link,
  Table,
  TableContainer,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tooltip,
  Tr,
} from '@chakra-ui/react';
import { FiEye, FiTrash2 } from 'react-icons/fi';
import { getScoreBand } from '../../lib/score';
import type { AdminRoast } from '../../types';
import { formatDateTime, INTENSITY_META } from './format';
import { StatusBadge } from './StatusBadge';
import { TableSkeletonRows } from './TableSkeletonRows';

interface RoastsTableProps {
  roasts: AdminRoast[];
  isLoading: boolean;
  onView: (roast: AdminRoast) => void;
  onDelete: (roast: AdminRoast) => void;
}

const COLUMNS = 7;

export function RoastsTable({ roasts, isLoading, onView, onDelete }: RoastsTableProps) {
  return (
    <TableContainer
      overflowX="auto"
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="xl"
      bg="bg.card"
    >
      <Table size="sm" variant="simple">
        <Thead>
          <Tr>
            <Th>Repo</Th>
            <Th>User</Th>
            <Th>Intensity</Th>
            <Th>Status</Th>
            <Th isNumeric>Score</Th>
            <Th>Created</Th>
            <Th textAlign="right">Actions</Th>
          </Tr>
        </Thead>
        <Tbody>
          {isLoading && roasts.length === 0 ? (
            <TableSkeletonRows columns={COLUMNS} />
          ) : roasts.length === 0 ? (
            <Tr>
              <Td colSpan={COLUMNS}>
                <Text textAlign="center" py={8} color="text.muted">
                  No roasts match these filters 🍳
                </Text>
              </Td>
            </Tr>
          ) : (
            roasts.map((roast) => {
              const intensity = INTENSITY_META[roast.intensity];
              const band = roast.overall_score !== null ? getScoreBand(roast.overall_score) : null;
              return (
                <Tr key={roast.id} opacity={isLoading ? 0.6 : 1}>
                  <Td maxW="16rem">
                    <Link href={roast.repo_url} isExternal color="accent.fire" fontWeight="medium" noOfLines={1}>
                      {roast.repo_owner}/{roast.repo_name}
                    </Link>
                  </Td>
                  <Td>
                    <Text fontSize="sm">{roast.user_email}</Text>
                  </Td>
                  <Td>
                    <Tooltip label={intensity?.label ?? roast.intensity}>
                      <Text as="span" aria-label={intensity?.label ?? roast.intensity}>
                        {intensity?.chilis ?? roast.intensity}
                      </Text>
                    </Tooltip>
                  </Td>
                  <Td>
                    <StatusBadge status={roast.status} />
                  </Td>
                  <Td isNumeric>
                    {band && roast.overall_score !== null ? (
                      <Badge colorScheme={band.colorScheme} variant="subtle">
                        {roast.overall_score}
                      </Badge>
                    ) : (
                      <Text as="span" color="text.muted">
                        —
                      </Text>
                    )}
                  </Td>
                  <Td>{formatDateTime(roast.created_at)}</Td>
                  <Td>
                    <HStack justify="flex-end" spacing={1}>
                      <IconButton
                        aria-label={`View roast of ${roast.repo_owner}/${roast.repo_name}`}
                        icon={<FiEye />}
                        size="sm"
                        variant="ghost"
                        onClick={() => onView(roast)}
                      />
                      <IconButton
                        aria-label={`Delete roast of ${roast.repo_owner}/${roast.repo_name}`}
                        icon={<FiTrash2 />}
                        size="sm"
                        variant="ghost"
                        colorScheme="red"
                        onClick={() => onDelete(roast)}
                      />
                    </HStack>
                  </Td>
                </Tr>
              );
            })
          )}
        </Tbody>
      </Table>
    </TableContainer>
  );
}

export default RoastsTable;
