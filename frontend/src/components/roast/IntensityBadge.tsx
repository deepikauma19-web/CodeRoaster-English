import { Badge, type BadgeProps } from '@chakra-ui/react';
import { getIntensityOption } from '../../lib/roastUi';
import type { RoastIntensity } from '../../types/roast';

export interface IntensityBadgeProps extends Omit<BadgeProps, 'children'> {
  intensity: RoastIntensity;
}

const INTENSITY_COLOR: Record<RoastIntensity, string> = {
  mild: 'yellow',
  medium: 'orange',
  extra_spicy: 'red',
};

export function IntensityBadge({ intensity, ...rest }: IntensityBadgeProps) {
  const option = getIntensityOption(intensity);
  return (
    <Badge
      colorScheme={INTENSITY_COLOR[intensity]}
      variant="subtle"
      borderRadius="full"
      px={3}
      py={1}
      textTransform="none"
      fontSize="sm"
      aria-label={`Intensity: ${option.label}`}
      {...rest}
    >
      <span aria-hidden="true">{option.chilis}</span> {option.label}
    </Badge>
  );
}

export default IntensityBadge;
