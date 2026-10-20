import { useState } from 'react';
import {
  Button,
  FormControl,
  FormLabel,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  Textarea,
  useDisclosure,
  useToast,
} from '@chakra-ui/react';
import { getErrorMessage } from '../../services/api';
import { reportPublicRoast } from '../../services/shareApi';
import type { ReportReason } from '../../types/share';

interface ReportRoastButtonProps {
  shareSlug: string;
}

const REASONS: readonly { value: ReportReason; label: string }[] = [
  { value: 'owner_request', label: 'This is my repo and I want it removed' },
  { value: 'harassment', label: 'It is unfair, abusive or targets a person' },
  { value: 'secrets', label: 'It exposes a secret or private information' },
  { value: 'other', label: 'Something else' },
];

const DETAILS_MAX = 500;

/** "Report this roast" link that opens a small form and posts to the public report endpoint. */
export function ReportRoastButton({ shareSlug }: ReportRoastButtonProps): JSX.Element {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const toast = useToast();
  const [reason, setReason] = useState<ReportReason>('owner_request');
  const [details, setDetails] = useState('');
  const [isSending, setIsSending] = useState(false);

  const handleSubmit = async (): Promise<void> => {
    setIsSending(true);
    try {
      await reportPublicRoast(shareSlug, { reason, details: details.trim() || undefined });
      toast({ status: 'success', title: 'Thanks, we received your report', duration: 4000, isClosable: true });
      setDetails('');
      onClose();
    } catch (err: unknown) {
      toast({
        status: 'error',
        title: 'Could not send the report',
        description: getErrorMessage(err),
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <Button variant="link" size="sm" colorScheme="ink" onClick={onOpen} data-testid="report-roast-button">
        Report this roast
      </Button>
      <Modal isOpen={isOpen} onClose={onClose} isCentered>
        <ModalOverlay />
        <ModalContent mx={4}>
          <ModalHeader>Report this roast</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <FormControl mb={4}>
              <FormLabel htmlFor="report-reason">What is wrong?</FormLabel>
              <Select id="report-reason" value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}>
                {REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </FormControl>
            <FormControl>
              <FormLabel htmlFor="report-details">Details (optional)</FormLabel>
              <Textarea
                id="report-details"
                value={details}
                maxLength={DETAILS_MAX}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Anything that helps us review it"
                rows={3}
              />
            </FormControl>
          </ModalBody>
          <ModalFooter gap={3}>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              isLoading={isSending}
              onClick={() => {
                void handleSubmit();
              }}
            >
              Send report
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

export default ReportRoastButton;
