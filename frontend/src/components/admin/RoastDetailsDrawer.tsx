import {
  Alert,
  AlertDescription,
  AlertIcon,
  Badge,
  Box,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  DrawerOverlay,
  HStack,
  Link,
  Stack,
  Text,
} from '@chakra-ui/react';
import type { ReactNode } from 'react';
import { getScoreBand, SCORE_MAX } from '../../lib/score';
import type { AdminRoast } from '../../types';
import { formatDateTime, INTENSITY_META } from './format';
import { StatusBadge } from './StatusBadge';

interface RoastDetailsDrawerProps {
  roast: AdminRoast | null;
  onClose: () => void;
}

interface DetailRowProps {
  label: string;
  children: ReactNode;
}

function DetailRow({ label, children }: DetailRowProps) {
  return (
    <Box>
      <Text fontSize="xs" textTransform="uppercase" color="text.muted" mb={1}>
        {label}
      </Text>
      {children}
    </Box>
  );
}

export function RoastDetailsDrawer({ roast, onClose }: RoastDetailsDrawerProps) {
  const band = roast?.overall_score != null ? getScoreBand(roast.overall_score) : null;
  return (
    <Drawer isOpen={roast !== null} placement="right" onClose={onClose} size="md">
      <DrawerOverlay />
      <DrawerContent bg="bg.surface">
        <DrawerCloseButton />
        <DrawerHeader borderBottomWidth="1px" borderColor="border.subtle" pr={12}>
          {roast ? `${roast.repo_owner}/${roast.repo_name}` : 'Roast'}
        </DrawerHeader>
        <DrawerBody py={6}>
          {roast && (
            <Stack spacing={5}>
              <HStack spacing={3} wrap="wrap">
                <StatusBadge status={roast.status} />
                <Badge variant="outline">
                  {INTENSITY_META[roast.intensity]?.chilis} {INTENSITY_META[roast.intensity]?.label ?? roast.intensity}
                </Badge>
                <Badge variant="outline">{roast.is_public ? 'Public' : 'Private'}</Badge>
              </HStack>
              <DetailRow label="Repository">
                <Link href={roast.repo_url} isExternal color="accent.fire" wordBreak="break-all">
                  {roast.repo_url}
                </Link>
              </DetailRow>
              <DetailRow label="User">
                <Text>{roast.user_email}</Text>
              </DetailRow>
              <DetailRow label="Score">
                {band && roast.overall_score !== null ? (
                  <HStack>
                    <Text fontSize="2xl" fontWeight="bold" color={`${band.colorScheme}.400`}>
                      {roast.overall_score}/{SCORE_MAX}
                    </Text>
                    <Badge colorScheme={band.colorScheme}>{band.label}</Badge>
                  </HStack>
                ) : (
                  <Text color="text.muted">Not scored</Text>
                )}
              </DetailRow>
              <DetailRow label="Summary">
                <Text whiteSpace="pre-wrap">{roast.summary ?? '—'}</Text>
              </DetailRow>
              {roast.error_message && (
                <Alert status="error" borderRadius="lg" alignItems="flex-start">
                  <AlertIcon />
                  <AlertDescription wordBreak="break-word">{roast.error_message}</AlertDescription>
                </Alert>
              )}
              <HStack spacing={6}>
                <DetailRow label="Created">
                  <Text fontSize="sm">{formatDateTime(roast.created_at)}</Text>
                </DetailRow>
                <DetailRow label="Completed">
                  <Text fontSize="sm">{formatDateTime(roast.completed_at)}</Text>
                </DetailRow>
              </HStack>
              <DetailRow label="Files analyzed">
                <Text fontSize="sm">{roast.files_analyzed}</Text>
              </DetailRow>
            </Stack>
          )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}

export default RoastDetailsDrawer;
