import { Badge } from '@chakra-ui/react';
import type { RoastStatus } from '../../types';
import { STATUS_META } from './format';

interface StatusBadgeProps {
  status: RoastStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const meta = STATUS_META[status] ?? { label: status, colorScheme: 'gray' };
  return (
    <Badge colorScheme={meta.colorScheme} variant="subtle" borderRadius="full" px={2}>
      {meta.label}
    </Badge>
  );
}

export default StatusBadge;
