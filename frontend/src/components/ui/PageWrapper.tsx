import { Container, type ContainerProps } from '@chakra-ui/react';
import type { MotionSafe } from '../../lib/motion';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

const MotionContainer = motion.create(Container);

interface PageWrapperProps extends MotionSafe<ContainerProps> {
  children: ReactNode;
}

export function PageWrapper({ children, ...rest }: PageWrapperProps) {
  return (
    <MotionContainer
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.3 }}
      maxW="container.lg"
      py={{ base: 6, md: 10 }}
      px={{ base: 4, md: 6 }}
      {...rest}
    >
      {children}
    </MotionContainer>
  );
}

export default PageWrapper;
