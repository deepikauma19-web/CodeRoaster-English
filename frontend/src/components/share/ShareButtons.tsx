import { useEffect, useState, type ChangeEvent } from 'react';
import {
  Button,
  FormControl,
  FormLabel,
  HStack,
  Icon,
  Input,
  InputGroup,
  InputRightElement,
  Stack,
  Switch,
  Text,
  Wrap,
  WrapItem,
  useClipboard,
  useToast,
} from '@chakra-ui/react';
import type { IconType } from 'react-icons';
import { FaLinkedin, FaWhatsapp, FaXTwitter } from 'react-icons/fa6';
import { FiAlertTriangle, FiCheck, FiCopy, FiLock } from 'react-icons/fi';
import { getErrorMessage } from '../../services/api';
import { buildShareUrl, toggleRoastShare } from '../../services/shareApi';
import type { Roast } from '../../types/roast';
import type { SharePlatform } from '../../types/share';
import { BadgeSnippet } from './BadgeSnippet';
import { buildPlatformLinks, buildShareText, copyWithClipboardApi } from './shareLinks';

interface ShareButtonsProps {
  roast: Roast;
  onRoastChange: (roast: Roast) => void;
}

const PLATFORM_STYLE: Record<SharePlatform, { icon: IconType; colorScheme: string }> = {
  whatsapp: { icon: FaWhatsapp, colorScheme: 'whatsapp' },
  linkedin: { icon: FaLinkedin, colorScheme: 'linkedin' },
  x: { icon: FaXTwitter, colorScheme: 'gray' },
};

const COPIED_RESET_MS = 2000;

export function ShareButtons({ roast, onRoastChange }: ShareButtonsProps): JSX.Element {
  const toast = useToast();
  const [isToggling, setIsToggling] = useState(false);
  // share_url returned by the last PATCH; falls back to building it from the slug.
  const [serverShareUrl, setServerShareUrl] = useState<string | null>(null);
  const [apiCopied, setApiCopied] = useState(false);

  const shareUrl =
    roast.is_public && roast.share_slug ? (serverShareUrl ?? buildShareUrl(roast.share_slug)) : null;

  const { onCopy: fallbackCopy, hasCopied: fallbackCopied, setValue } = useClipboard(shareUrl ?? '', COPIED_RESET_MS);

  useEffect(() => {
    setValue(shareUrl ?? '');
  }, [shareUrl, setValue]);

  useEffect(() => {
    if (!apiCopied) return undefined;
    const timer = window.setTimeout(() => setApiCopied(false), COPIED_RESET_MS);
    return () => window.clearTimeout(timer);
  }, [apiCopied]);

  const isCompleted = roast.status === 'completed';
  const blockReason = roast.share_blocked
    ? 'Sharing is off for this roast because it was reported.'
    : roast.secrets_detected > 0
      ? 'Sharing is off because secrets were found in this repo. Remove them and roast again.'
      : null;
  const shareDisabled = blockReason !== null && !roast.is_public;
  const hasCopied = apiCopied || fallbackCopied;

  const handleToggle = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const nextPublic = event.target.checked;
    setIsToggling(true);
    try {
      const result = await toggleRoastShare(roast.id, nextPublic);
      setServerShareUrl(result.share_url);
      onRoastChange({
        ...roast,
        is_public: result.is_public,
        share_slug: result.share_slug ?? roast.share_slug,
      });
      toast({
        status: 'success',
        title: result.is_public ? 'Your roast is public now 🔥 Share it!' : 'Your roast is private again 🔒',
        duration: 2500,
        isClosable: true,
      });
    } catch (err: unknown) {
      toast({
        status: 'error',
        title: 'Could not change the share setting',
        description: getErrorMessage(err),
        duration: 4000,
        isClosable: true,
      });
    } finally {
      setIsToggling(false);
    }
  };

  const handleCopy = async (): Promise<void> => {
    if (!shareUrl) return;
    const ok = await copyWithClipboardApi(shareUrl);
    if (ok) {
      setApiCopied(true);
    } else {
      fallbackCopy();
    }
    toast({ status: 'success', title: 'Link copied 📋', duration: 1500 });
  };

  const platformLinks = shareUrl ? buildPlatformLinks(shareUrl, buildShareText(roast.overall_score)) : [];

  return (
    <Stack spacing={4} w="full">
      <FormControl display="flex" alignItems="center" isDisabled={!isCompleted || isToggling || shareDisabled}>
        <Switch
          id={`share-toggle-${roast.id}`}
          colorScheme="ink"
          isChecked={roast.is_public}
          onChange={(e) => {
            void handleToggle(e);
          }}
          mr={3}
        />
        <FormLabel htmlFor={`share-toggle-${roast.id}`} mb={0} fontWeight="semibold">
          Make public
        </FormLabel>
      </FormControl>

      {shareUrl ? (
        <Stack spacing={3}>
          <InputGroup size="md">
            <Input
              value={shareUrl}
              isReadOnly
              aria-label="Share link"
              pr="6.5rem"
              fontFamily="mono"
              fontSize="sm"
              onFocus={(e) => e.target.select()}
            />
            <InputRightElement width="6rem" pr={1}>
              <Button
                size="sm"
                h="1.9rem"
                leftIcon={<Icon as={hasCopied ? FiCheck : FiCopy} />}
                onClick={() => {
                  void handleCopy();
                }}
                aria-label="Copy share link"
              >
                {hasCopied ? 'Copied' : 'Copy'}
              </Button>
            </InputRightElement>
          </InputGroup>

          <Wrap spacing={2}>
            {platformLinks.map((link) => {
              const style = PLATFORM_STYLE[link.platform];
              return (
                <WrapItem key={link.platform}>
                  <Button
                    as="a"
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="sm"
                    variant="outline"
                    colorScheme={style.colorScheme}
                    leftIcon={<Icon as={style.icon} />}
                    aria-label={`Share on ${link.label}`}
                  >
                    {link.label}
                  </Button>
                </WrapItem>
              );
            })}
          </Wrap>

          {roast.share_slug && <BadgeSnippet shareSlug={roast.share_slug} shareUrl={shareUrl} />}
        </Stack>
      ) : shareDisabled ? (
        <HStack spacing={2} color="text.muted" align="flex-start" data-testid="share-blocked">
          <Icon as={FiAlertTriangle} mt={1} />
          <Text fontSize="sm">{blockReason}</Text>
        </HStack>
      ) : (
        <HStack spacing={2} color="text.muted">
          <Icon as={FiLock} />
          <Text fontSize="sm">
            {isCompleted
              ? 'Make it public to share'
              : 'You can share once the roast is complete'}
          </Text>
        </HStack>
      )}
    </Stack>
  );
}

export default ShareButtons;
