import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Button,
} from '@chakra-ui/react';
import { useRef, type ReactNode } from 'react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  colorScheme?: string;
  isLoading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  body,
  confirmLabel = 'Confirm',
  colorScheme = 'brand',
  isLoading = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog
      isOpen={isOpen}
      leastDestructiveRef={cancelRef}
      onClose={isLoading ? () => undefined : onClose}
      isCentered
    >
      <AlertDialogOverlay backdropFilter="blur(4px)">
        <AlertDialogContent bg="bg.surface" mx={4}>
          <AlertDialogHeader fontSize="lg" fontWeight="bold">
            {title}
          </AlertDialogHeader>
          <AlertDialogBody>{body}</AlertDialogBody>
          <AlertDialogFooter gap={3}>
            <Button ref={cancelRef} variant="ghost" onClick={onClose} isDisabled={isLoading}>
              Cancel
            </Button>
            <Button colorScheme={colorScheme} onClick={onConfirm} isLoading={isLoading}>
              {confirmLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogOverlay>
    </AlertDialog>
  );
}

export default ConfirmDialog;
