import { Skeleton, Td, Tr } from '@chakra-ui/react';

interface TableSkeletonRowsProps {
  rows?: number;
  columns: number;
}

export function TableSkeletonRows({ rows = 5, columns }: TableSkeletonRowsProps) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <Tr key={r}>
          {Array.from({ length: columns }, (_, c) => (
            <Td key={c}>
              <Skeleton h="1rem" borderRadius="md" />
            </Td>
          ))}
        </Tr>
      ))}
    </>
  );
}

export default TableSkeletonRows;
