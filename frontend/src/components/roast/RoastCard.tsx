import { Box, Code, Heading, Link, ListItem, OrderedList, Text, UnorderedList } from '@chakra-ui/react';
import type { ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import { GlassCard } from '../ui';

export interface RoastCardProps {
  /** Markdown roast text. Raw HTML is never rendered. */
  markdown: string;
  title?: string;
}

interface ChildrenProps {
  children?: ReactNode;
}

const markdownComponents: Components = {
  p: ({ children }: ChildrenProps) => (
    <Text mb={4} lineHeight="tall">
      {children}
    </Text>
  ),
  ul: ({ children }: ChildrenProps) => (
    <UnorderedList mb={4} spacing={2} pl={2}>
      {children}
    </UnorderedList>
  ),
  ol: ({ children }: ChildrenProps) => (
    <OrderedList mb={4} spacing={2} pl={2}>
      {children}
    </OrderedList>
  ),
  li: ({ children }: ChildrenProps) => <ListItem lineHeight="tall">{children}</ListItem>,
  h1: ({ children }: ChildrenProps) => (
    <Heading as="h3" size="md" mt={2} mb={3}>
      {children}
    </Heading>
  ),
  h2: ({ children }: ChildrenProps) => (
    <Heading as="h3" size="md" mt={2} mb={3}>
      {children}
    </Heading>
  ),
  h3: ({ children }: ChildrenProps) => (
    <Heading as="h4" size="sm" mt={2} mb={2}>
      {children}
    </Heading>
  ),
  code: ({ children }: ChildrenProps) => (
    <Code colorScheme="orange" fontSize="0.9em" whiteSpace="pre-wrap" wordBreak="break-word">
      {children}
    </Code>
  ),
  pre: ({ children }: ChildrenProps) => (
    <Box as="pre" mb={4} p={3} borderRadius="md" bg="bg.code" overflowX="auto">
      {children}
    </Box>
  ),
  a: ({ children, href }: ChildrenProps & { href?: string }) => (
    <Link href={href} color="accent.fire" isExternal rel="noopener noreferrer nofollow">
      {children}
    </Link>
  ),
  img: () => null,
};

/** Renders the roast markdown. No rehype-raw: HTML in the source is skipped. */
export function RoastCard({ markdown, title = 'The Roast 🔥' }: RoastCardProps) {
  return (
    <GlassCard static data-testid="roast-card">
      <Heading as="h2" size="md" mb={4}>
        {title}
      </Heading>
      <Box fontSize={{ base: 'md', md: 'lg' }}>
        <Markdown skipHtml components={markdownComponents}>
          {markdown}
        </Markdown>
      </Box>
    </GlassCard>
  );
}

export default RoastCard;
