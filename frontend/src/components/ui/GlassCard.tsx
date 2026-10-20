import { Box, type BoxProps } from '@chakra-ui/react';
import type { MotionSafe } from '../../lib/motion';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

const MotionBox = motion.create(Box);

interface GlassCardProps extends MotionSafe<BoxProps> {
  children: ReactNode;
  /** Disable the hover lift (e.g. for large static containers). */
  static?: boolean;
}

export function GlassCard({ children, static: isStatic = false, ...rest }: GlassCardProps) {
  return (
    <MotionBox
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={isStatic ? undefined : { y: -4, scale: 1.01 }}
      transition={{ duration: 0.25 }}
      p={6}
      borderRadius="2xl"
      bg="bg.card"
      backdropFilter="blur(16px)"
      borderWidth="1px"
      borderColor="border.subtle"
      boxShadow="xl"
      {...rest}
    >
      {children}
    </MotionBox>
  );
}

export default GlassCard;
