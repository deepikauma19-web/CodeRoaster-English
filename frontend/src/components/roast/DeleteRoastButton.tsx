import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Button,
  type ButtonProps,
  useDisclosure,
  useToast,
} from '@chakra-ui/react';
import { useRef, useState } from 'react';
import { FaTrash } from 'react-icons/fa';
import { getErrorMessage } from '../../services/api';
import { deleteRoast } from '../../services/roastApi';

export interface DeleteRoastButtonProps extends Omit<ButtonProps, 'onClick' | 'children'> {
  roastId: number;
  onDeleted: () => void;
}

/** Owner-only delete with a confirmation dialog. */
export function DeleteRoastButton({ roastId, onDeleted, ...rest }: DeleteRoastButtonProps) {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const toast = useToast();

  const handleDelete = async (): Promise<void> => {
    setIsDeleting(true);
    try {
      await deleteRoast(roastId);
      onClose();
      toast({ status: 'success', title: 'Roast deleted.', duration: 3000 });
      onDeleted();
    } catch (err: unknown) {
      toast({ status: 'error', title: 'Could not delete the roast', description: getErrorMessage(err), duration: 5000 });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Button leftIcon={<FaTrash />} colorScheme="red" variant="outline" onClick={onOpen} {...rest}>
        Delete
      </Button>
      <AlertDialog isOpen={isOpen} leastDestructiveRef={cancelRef} onClose={onClose} isCentered>
        <AlertDialogOverlay>
          <AlertDialogContent mx={4}>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Delete this roast?
            </AlertDialogHeader>
            <AlertDialogBody>This is permanent and the share link will stop working. Are you sure?</AlertDialogBody>
            <AlertDialogFooter gap={3}>
              <Button ref={cancelRef} variant="ghost" onClick={onClose} isDisabled={isDeleting}>
                Cancel
              </Button>
              <Button colorScheme="red" onClick={() => void handleDelete()} isLoading={isDeleting}>
                Delete
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </>
  );
}

export default DeleteRoastButton;
