import { Button, type ButtonProps } from '@chakra-ui/react';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { FcGoogle } from 'react-icons/fc';
import { useAuth } from '../../hooks/useAuth';
import type { MotionSafe } from '../../lib/motion';

const MotionButton = motion.create(Button);

type GoogleSignInButtonProps = MotionSafe<Omit<ButtonProps, 'onClick' | 'children'>> & {
  label?: string;
};

/** "Sign in with Google" — full-page redirect to the backend OAuth endpoint. */
export function GoogleSignInButton({ label = 'Sign in with Google', ...rest }: GoogleSignInButtonProps) {
  const { loginWithGoogle } = useAuth();
  const [redirecting, setRedirecting] = useState(false);

  const handleClick = (): void => {
    setRedirecting(true);
    loginWithGoogle();
  };

  return (
    <MotionButton
      whileHover={{ scale: 1.03, y: -2 }}
      whileTap={{ scale: 0.97 }}
      onClick={handleClick}
      isLoading={redirecting}
      loadingText="Redirecting to Google…"
      leftIcon={<FcGoogle aria-hidden="true" />}
      size="lg"
      bg="white"
      color="gray.800"
      borderWidth="1px"
      borderColor="gray.200"
      boxShadow="lg"
      _hover={{ bg: 'gray.50' }}
      _active={{ bg: 'gray.100' }}
      _focusVisible={{ boxShadow: '0 0 0 3px var(--chakra-colors-brand-400)' }}
      aria-label={label}
      {...rest}
    >
      {label}
    </MotionButton>
  );
}

export default GoogleSignInButton;
