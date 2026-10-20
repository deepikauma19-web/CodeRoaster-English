import { Button, Flex, HStack, IconButton, Text } from '@chakra-ui/react';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { formatNumber } from './format';

interface PaginationProps {
  page: number;
  size: number;
  total: number;
  onPageChange: (page: number) => void;
  isDisabled?: boolean;
}

export function Pagination({ page, size, total, onPageChange, isDisabled = false }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / size));
  const start = total === 0 ? 0 : (page - 1) * size + 1;
  const end = Math.min(total, page * size);
  return (
    <Flex
      justify="space-between"
      align="center"
      direction={{ base: 'column', sm: 'row' }}
      gap={3}
      mt={4}
      as="nav"
      aria-label="Pagination"
    >
      <Text fontSize="sm" color="text.muted">
        {total === 0 ? 'No results' : `Showing ${formatNumber(start)}–${formatNumber(end)} of ${formatNumber(total)}`}
      </Text>
      <HStack spacing={2}>
        <IconButton
          aria-label="Previous page"
          icon={<FiChevronLeft />}
          size="sm"
          variant="outline"
          isDisabled={isDisabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
        />
        <Button size="sm" variant="ghost" isDisabled pointerEvents="none">
          {page} / {totalPages}
        </Button>
        <IconButton
          aria-label="Next page"
          icon={<FiChevronRight />}
          size="sm"
          variant="outline"
          isDisabled={isDisabled || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        />
      </HStack>
    </Flex>
  );
}

export default Pagination;
