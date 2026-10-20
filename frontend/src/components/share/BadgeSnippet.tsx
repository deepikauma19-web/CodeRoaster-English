import { useState } from 'react';
import { Button, Icon, Image, Input, InputGroup, InputRightElement, Stack, Text, useToast } from '@chakra-ui/react';
import { FiCheck, FiCopy } from 'react-icons/fi';
import { buildBadgeMarkdown, buildBadgeUrl } from '../../services/shareApi';
import { copyWithClipboardApi } from './shareLinks';

interface BadgeSnippetProps {
  shareSlug: string;
  shareUrl: string;
}

const COPIED_RESET_MS = 2000;

/** Badge preview plus a copy-paste Markdown snippet for the user's README. */
export function BadgeSnippet({ shareSlug, shareUrl }: BadgeSnippetProps): JSX.Element {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const markdown = buildBadgeMarkdown(shareSlug, shareUrl);

  const handleCopy = async (): Promise<void> => {
    const ok = await copyWithClipboardApi(markdown);
    if (!ok) {
      toast({ status: 'info', title: 'Select the snippet and copy it manually', duration: 2500 });
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
    toast({ status: 'success', title: 'Badge snippet copied 📋', duration: 1500 });
  };

  return (
    <Stack spacing={2} data-testid="badge-snippet">
      <Text fontWeight="semibold" fontSize="sm">
        README badge
      </Text>
      <Image src={buildBadgeUrl(shareSlug)} alt="Code Roaster score badge" alignSelf="flex-start" h="20px" />
      <InputGroup size="md">
        <Input
          value={markdown}
          isReadOnly
          aria-label="Badge markdown"
          pr="6.5rem"
          fontFamily="mono"
          fontSize="xs"
          onFocus={(e) => e.target.select()}
        />
        <InputRightElement width="6rem" pr={1}>
          <Button
            size="sm"
            h="1.9rem"
            leftIcon={<Icon as={copied ? FiCheck : FiCopy} />}
            onClick={() => {
              void handleCopy();
            }}
            aria-label="Copy badge markdown"
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </InputRightElement>
      </InputGroup>
    </Stack>
  );
}

export default BadgeSnippet;
