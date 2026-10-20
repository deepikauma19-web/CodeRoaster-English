import { Box, Button, type ButtonProps } from '@chakra-ui/react';
import { motion, useReducedMotion } from 'framer-motion';
import type { MotionSafe } from '../../lib/motion';

const MotionButton = motion.create(Button);
const MotionFlame = motion.create(Box);

export interface RoastMeButtonProps extends MotionSafe<Omit<ButtonProps, 'children'>> {
  isLoading?: boolean;
  label?: string;
}

/** Big gradient CTA with a flickering flame. Animations are skipped for reduced-motion users. */
export function RoastMeButton({ isLoading = false, isDisabled, label = 'Roast Me', type = 'submit', ...rest }: RoastMeButtonProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const interactive = !reduceMotion && !isLoading && !isDisabled;

  return (
    <MotionButton
      type={type}
      size="lg"
      w={{ base: 'full', sm: 'auto' }}
      minW={{ sm: '220px' }}
      h={14}
      fontSize="lg"
      color="white"
      bg="ink.500"
      boxShadow="0 10px 30px -12px rgba(10, 10, 10, 0.6)"
      _hover={{ bg: 'brand.400', color: 'ink.500' }}
      _active={{ bg: 'brand.500', color: 'ink.500' }}
      isLoading={isLoading}
      loadingText="Roasting…"
      isDisabled={isDisabled}
      whileHover={interactive ? { scale: 1.04, y: -2 } : undefined}
      whileTap={interactive ? { scale: 0.96 } : undefined}
      {...rest}
    >
      {label}
      <MotionFlame
        as="span"
        ml={2}
        display="inline-block"
        aria-hidden="true"
        animate={reduceMotion ? undefined : { scale: [1, 1.2, 0.95, 1.1, 1], rotate: [0, -8, 6, -4, 0] }}
        transition={reduceMotion ? undefined : { duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
      >
        🔥
      </MotionFlame>
    </MotionButton>
  );
}

export default RoastMeButton;
