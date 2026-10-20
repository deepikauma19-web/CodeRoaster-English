import { Badge, Box, Checkbox, Code, Flex, Heading, Stack, Text } from '@chakra-ui/react';
import { useState } from 'react';
import { TIP_PRIORITY_COLOR } from '../../lib/roastUi';
import type { Tip } from '../../types/roast';

export interface TipsListProps {
  tips: Tip[];
  /** Show checkboxes (local state only, not persisted). */
  interactive?: boolean;
}

/** Actionable tips with priority badges. Pure presentational (checkbox state is local). */
export function TipsList({ tips, interactive = false }: TipsListProps) {
  const [done, setDone] = useState<ReadonlySet<number>>(new Set());

  const toggle = (index: number): void => {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  if (tips.length === 0) {
    return (
      <Text color="text.muted" data-testid="tips-empty">
        No tips needed. Are you sure you wrote this yourself? 🏆
      </Text>
    );
  }

  return (
    <Stack spacing={3} data-testid="tips-list">
      {interactive && (
        <Text fontSize="sm" color="text.muted">
          {done.size}/{tips.length} fixed
        </Text>
      )}
      {tips.map((tip, index) => {
        const isDone = done.has(index);
        const body = (
          <Box flex="1" minW={0}>
            <Flex gap={2} align="center" wrap="wrap" mb={1}>
              <Badge colorScheme={TIP_PRIORITY_COLOR[tip.priority]} textTransform="uppercase" fontSize="2xs">
                {tip.priority}
              </Badge>
              <Heading as="h3" size="sm" textDecoration={isDone ? 'line-through' : 'none'} opacity={isDone ? 0.6 : 1}>
                {tip.title}
              </Heading>
            </Flex>
            <Text fontSize="sm" color="text.muted" opacity={isDone ? 0.6 : 1}>
              {tip.description}
            </Text>
            {tip.file_path && (
              <Code mt={2} fontSize="xs" colorScheme="orange" wordBreak="break-all">
                {tip.file_path}
              </Code>
            )}
          </Box>
        );
        return (
          <Flex
            key={`${index}-${tip.title}`}
            p={4}
            gap={3}
            align="flex-start"
            borderRadius="xl"
            borderWidth="1px"
            borderColor="border.subtle"
            bg="bg.card"
          >
            {interactive && (
              <Checkbox
                mt={1}
                colorScheme="green"
                isChecked={isDone}
                onChange={() => toggle(index)}
                aria-label={`Mark "${tip.title}" as done`}
              />
            )}
            {body}
          </Flex>
        );
      })}
    </Stack>
  );
}

export default TipsList;
