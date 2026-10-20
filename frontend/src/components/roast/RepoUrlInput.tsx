import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  Input,
  InputGroup,
  InputLeftElement,
  Icon,
} from '@chakra-ui/react';
import type { ChangeEvent } from 'react';
import { FaGithub } from 'react-icons/fa';

export interface RepoUrlInputProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string | null;
  isDisabled?: boolean;
  id?: string;
}

export function RepoUrlInput({ value, onChange, onBlur, error, isDisabled = false, id = 'repo-url' }: RepoUrlInputProps) {
  return (
    <FormControl isInvalid={Boolean(error)} isDisabled={isDisabled} isRequired>
      <FormLabel htmlFor={id}>GitHub repo URL</FormLabel>
      <InputGroup size="lg">
        <InputLeftElement pointerEvents="none">
          <Icon as={FaGithub} color="text.muted" />
        </InputLeftElement>
        <Input
          id={id}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://github.com/username/repo"
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          onBlur={onBlur}
          borderRadius="xl"
          focusBorderColor="ink.500"
        />
      </InputGroup>
      {error ? (
        <FormErrorMessage>{error}</FormErrorMessage>
      ) : (
        <FormHelperText color="text.muted">Public repos only. Private repos cannot be roasted.</FormHelperText>
      )}
    </FormControl>
  );
}

export default RepoUrlInput;
