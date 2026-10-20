import { Button, type ButtonProps } from '@chakra-ui/react';
import { motion } from 'framer-motion';
import { Link as RouterLink } from 'react-router-dom';
import type { MotionSafe } from '../../lib/motion';

const MotionButton = motion.create(Button);

interface GradientButtonProps extends MotionSafe<ButtonProps> {
  /** When set, renders as a react-router Link to this path. */
  to?: string;
}

/** Primary call-to-action: black pill that flips to lime on hover. */
export function GradientButton({ children, to, ...rest }: GradientButtonProps) {
  const linkProps = to ? { as: RouterLink, to } : {};
  return (
    <MotionButton
      whileHover={{ scale: 1.03, y: -2 }}
      whileTap={{ scale: 0.97 }}
      bg="ink.500"
      color="white"
      px={6}
      borderRadius="full"
      fontWeight="semibold"
      boxShadow="0 8px 24px -10px rgba(10, 10, 10, 0.5)"
      _hover={{ bg: 'brand.400', color: 'ink.500' }}
      _active={{ bg: 'brand.500', color: 'ink.500' }}
      {...linkProps}
      {...rest}
    >
      {children}
    </MotionButton>
  );
}

export default GradientButton;
