import { Badge, Flex, HStack, Icon, Text, Wrap, WrapItem } from '@chakra-ui/react';
import { FaClock, FaCode, FaFileCode } from 'react-icons/fa';
import type { LanguageBreakdown } from '../../types/roast';

export interface RepoMetaBarProps {
  languageBreakdown: LanguageBreakdown | null;
  filesAnalyzed: number;
  completedAt?: string | null;
  /** Max number of languages shown. */
  maxLanguages?: number;
}

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

/** Languages, files analysed and completion time. Pure presentational. */
export function RepoMetaBar({ languageBreakdown, filesAnalyzed, completedAt, maxLanguages = 4 }: RepoMetaBarProps) {
  const languages = Object.entries(languageBreakdown ?? {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, maxLanguages);

  return (
    <Flex gap={{ base: 2, md: 4 }} wrap="wrap" align="center" fontSize="sm" color="text.muted" data-testid="repo-meta">
      {languages.length > 0 && (
        <HStack spacing={2} align="center">
          <Icon as={FaCode} aria-hidden="true" />
          <Wrap spacing={1}>
            {languages.map(([name, pct]) => (
              <WrapItem key={name}>
                <Badge variant="outline" colorScheme="gray" textTransform="none">
                  {name} {pct.toFixed(0)}%
                </Badge>
              </WrapItem>
            ))}
          </Wrap>
        </HStack>
      )}
      <HStack spacing={1}>
        <Icon as={FaFileCode} aria-hidden="true" />
        <Text>
          {filesAnalyzed} file{filesAnalyzed === 1 ? '' : 's'} analysed
        </Text>
      </HStack>
      {completedAt && (
        <HStack spacing={1}>
          <Icon as={FaClock} aria-hidden="true" />
          <Text>{formatDate(completedAt)}</Text>
        </HStack>
      )}
    </Flex>
  );
}

export default RepoMetaBar;
