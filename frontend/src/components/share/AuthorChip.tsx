import { Avatar, HStack, Text } from '@chakra-ui/react';

export interface AuthorChipProps {
  firstName: string | null;
  avatarUrl: string | null;
}

/** Small "roasted for <name>" pill used on the public roast page. */
export function AuthorChip({ firstName, avatarUrl }: AuthorChipProps): JSX.Element {
  const name = firstName?.trim() || 'Anonymous dev';
  return (
    <HStack
      spacing={2}
      px={3}
      py={1}
      borderRadius="full"
      borderWidth="1px"
      borderColor="border.subtle"
      bg="bg.card"
      data-testid="author-chip"
    >
      <Avatar size="xs" name={name} src={avatarUrl ?? undefined} />
      <Text fontSize="sm" fontWeight="medium">
        {name}
      </Text>
    </HStack>
  );
}

export default AuthorChip;
