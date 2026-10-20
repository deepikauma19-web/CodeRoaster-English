import {
  Avatar,
  Badge,
  Box,
  HStack,
  Switch,
  Table,
  TableContainer,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
} from '@chakra-ui/react';
import type { AdminUser, AdminUserUpdate } from '../../types';
import { formatDate, formatDateTime, formatNumber } from './format';
import { TableSkeletonRows } from './TableSkeletonRows';

type ToggleField = keyof Required<AdminUserUpdate>;

interface UsersTableProps {
  users: AdminUser[];
  isLoading: boolean;
  /** Id of the user currently being updated (disables their switches). */
  busyUserId: number | null;
  onToggle: (user: AdminUser, field: ToggleField, value: boolean) => void;
}

const COLUMNS = 7;

export function UsersTable({ users, isLoading, busyUserId, onToggle }: UsersTableProps) {
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
            <Th>User</Th>
            <Th isNumeric>Roasts</Th>
            <Th>Joined</Th>
            <Th>Last login</Th>
            <Th>Active</Th>
            <Th>Admin</Th>
            <Th srOnly>Status</Th>
          </Tr>
        </Thead>
        <Tbody>
          {isLoading && users.length === 0 ? (
            <TableSkeletonRows columns={COLUMNS} />
          ) : users.length === 0 ? (
            <Tr>
              <Td colSpan={COLUMNS}>
                <Text textAlign="center" py={8} color="text.muted">
                  No users found. Spooky quiet in here 🤷
                </Text>
              </Td>
            </Tr>
          ) : (
            users.map((user) => {
              const name = user.full_name ?? user.email.split('@')[0];
              const busy = busyUserId === user.id;
              return (
                <Tr key={user.id} opacity={isLoading ? 0.6 : 1}>
                  <Td>
                    <HStack spacing={3}>
                      <Avatar size="sm" name={name} src={user.avatar_url ?? undefined} />
                      <Box minW={0}>
                        <Text fontWeight="medium">{name}</Text>
                        <Text fontSize="xs" color="text.muted">
                          {user.email}
                        </Text>
                      </Box>
                    </HStack>
                  </Td>
                  <Td isNumeric>{formatNumber(user.roast_count)}</Td>
                  <Td>{formatDate(user.created_at)}</Td>
                  <Td>{formatDateTime(user.last_login_at)}</Td>
                  <Td>
                    <Switch
                      colorScheme="green"
                      isChecked={user.is_active}
                      isDisabled={busy}
                      aria-label={`${user.is_active ? 'Deactivate' : 'Activate'} ${user.email}`}
                      onChange={(e) => onToggle(user, 'is_active', e.target.checked)}
                    />
                  </Td>
                  <Td>
                    <Switch
                      colorScheme="ink"
                      isChecked={user.is_admin}
                      isDisabled={busy}
                      aria-label={`${user.is_admin ? 'Remove admin from' : 'Make admin'} ${user.email}`}
                      onChange={(e) => onToggle(user, 'is_admin', e.target.checked)}
                    />
                  </Td>
                  <Td>
                    {!user.is_active && (
                      <Badge colorScheme="red" variant="subtle">
                        Inactive
                      </Badge>
                    )}
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

export default UsersTable;
