import { Box, Stack, type StackProps } from '@chakra-ui/react';
import type { MotionSafe } from '../../lib/motion';
import { motion, type Variants } from 'framer-motion';
import { Children, type ReactNode } from 'react';

const MotionStack = motion.create(Stack);
const MotionBox = motion.create(Box);

const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

interface AnimatedListProps extends MotionSafe<StackProps> {
  children: ReactNode;
}

export function AnimatedList({ children, spacing = 3, ...rest }: AnimatedListProps) {
  return (
    <MotionStack initial="hidden" animate="visible" variants={containerVariants} spacing={spacing} {...rest}>
      {Children.toArray(children).map((child, i) => (
        <MotionBox key={i} variants={itemVariants}>
          {child}
        </MotionBox>
      ))}
    </MotionStack>
  );
}

export default AnimatedList;
