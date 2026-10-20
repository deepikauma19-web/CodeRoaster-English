import {
  Box,
  SimpleGrid,
  Text,
  VisuallyHidden,
  chakra,
  useRadio,
  useRadioGroup,
  type UseRadioProps,
} from '@chakra-ui/react';
import { DEFAULT_INTENSITY, INTENSITY_OPTIONS } from '../../lib/roastUi';
import type { RoastIntensity } from '../../types/roast';
import type { IntensityOption } from '../../types/roastUi';

export interface IntensityPickerProps {
  value?: RoastIntensity;
  onChange: (value: RoastIntensity) => void;
  isDisabled?: boolean;
  name?: string;
}

interface IntensityCardProps extends UseRadioProps {
  option: IntensityOption;
}

function IntensityCard({ option, ...radioProps }: IntensityCardProps) {
  const { state, getInputProps, getRadioProps, getLabelProps, htmlProps } = useRadio(radioProps);

  return (
    <chakra.label {...htmlProps} cursor={state.isDisabled ? 'not-allowed' : 'pointer'} display="block">
      <input {...getInputProps()} />
      <Box
        {...getRadioProps()}
        h="full"
        p={4}
        borderRadius="xl"
        borderWidth="2px"
        borderColor={state.isChecked ? 'accent.fire' : 'border.subtle'}
        bg={state.isChecked ? 'bg.subtle' : 'bg.card'}
        boxShadow={state.isChecked ? '0 0 0 3px rgba(212, 242, 60, 0.6)' : 'none'}
        opacity={state.isDisabled ? 0.6 : 1}
        transition="all 0.2s"
        _hover={state.isDisabled ? undefined : { borderColor: 'brand.300' }}
        _focusVisible={{ outline: '2px solid', outlineColor: 'brand.300', outlineOffset: '2px' }}
        data-testid={`intensity-${option.value}`}
      >
        <Text fontSize="2xl" aria-hidden="true" lineHeight="short">
          {option.chilis}
        </Text>
        <Text fontWeight="bold" mt={1} {...getLabelProps()}>
          {option.label}
        </Text>
        <Text fontSize="sm" color="text.muted" mt={1} fontStyle="italic">
          “{option.sample}”
        </Text>
        {state.isChecked && <VisuallyHidden>(selected)</VisuallyHidden>}
      </Box>
    </chakra.label>
  );
}

/** Three chili cards (mild / medium / extra spicy). Keyboard accessible via native radio inputs. */
export function IntensityPicker({
  value = DEFAULT_INTENSITY,
  onChange,
  isDisabled = false,
  name = 'intensity',
}: IntensityPickerProps) {
  const { getRootProps, getRadioProps } = useRadioGroup({
    name,
    value,
    isDisabled,
    onChange: (next: string) => onChange(next as RoastIntensity),
  });

  return (
    <SimpleGrid {...getRootProps()} role="radiogroup" aria-label="Roast intensity" columns={{ base: 1, sm: 3 }} spacing={3}>
      {INTENSITY_OPTIONS.map((option) => (
        <IntensityCard key={option.value} option={option} {...getRadioProps({ value: option.value })} />
      ))}
    </SimpleGrid>
  );
}

export default IntensityPicker;
