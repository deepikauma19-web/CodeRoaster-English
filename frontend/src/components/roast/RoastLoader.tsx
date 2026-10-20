import { Box, Circle, HStack, Spinner, Stack, Text, VStack } from '@chakra-ui/react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { RoastStatus } from '../../types/roast';

const MotionText = motion.create(Text);
const MotionBox = motion.create(Box);

type ActiveStatus = Extract<RoastStatus, 'pending' | 'fetching' | 'analyzing'>;

const LINES: Record<ActiveStatus, readonly string[]> = {
  pending: ['Waiting in the queue, like it is a cinema ticket line…', 'Sharpening the roast knives 🔪🌶️', 'Hang tight, the roast is marinating…'],
  fetching: ['Cloning the repo… no judgement yet.', 'Gathering all the files (all 47 of them)…', 'Checking if there is a README 👀 (please be there)'],
  analyzing: ['Reading your code. Slowly. With popcorn 🍿', 'Trying not to laugh at the variable names 😂', 'The roast is out of the oven 🔥'],
};

const STEPS: readonly { status: ActiveStatus; label: string }[] = [
  { status: 'pending', label: 'Queued' },
  { status: 'fetching', label: 'Fetching repo' },
  { status: 'analyzing', label: 'Roasting' },
];

const ROTATE_MS = 2500;

export interface RoastLoaderProps {
  status: RoastStatus;
}

const toActive = (status: RoastStatus): ActiveStatus =>
  status === 'fetching' || status === 'analyzing' ? status : 'pending';

/** Rotating loading lines plus a 3-step progress indicator. */
export function RoastLoader({ status }: RoastLoaderProps) {
  const active = toActive(status);
  const lines = LINES[active];
  const reduceMotion = useReducedMotion() ?? false;
  const [index, setIndex] = useState<number>(0);

  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % lines.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [lines]);

  const activeStep = STEPS.findIndex((s) => s.status === active);

  return (
    <VStack spacing={8} py={{ base: 10, md: 16 }} textAlign="center" role="status" aria-live="polite" data-testid="roast-loader">
      <MotionBox
        fontSize="6xl"
        aria-hidden="true"
        animate={reduceMotion ? undefined : { scale: [1, 1.15, 1], rotate: [0, -6, 6, 0] }}
        transition={reduceMotion ? undefined : { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      >
        🔥
      </MotionBox>

      <Box minH={8}>
        <AnimatePresence mode="wait">
          <MotionText
            key={`${active}-${index}`}
            fontSize={{ base: 'lg', md: 'xl' }}
            fontWeight="semibold"
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
          >
            {lines[index % lines.length]}
          </MotionText>
        </AnimatePresence>
      </Box>

      <Stack direction={{ base: 'column', sm: 'row' }} spacing={{ base: 3, sm: 6 }} align={{ base: 'flex-start', sm: 'center' }}>
        {STEPS.map((step, i) => {
          const done = i < activeStep;
          const current = i === activeStep;
          return (
            <HStack key={step.status} spacing={2} aria-current={current ? 'step' : undefined}>
              <Circle
                size={7}
                fontSize="xs"
                fontWeight="bold"
                bg={done ? 'green.400' : current ? 'brand.500' : 'bg.track'}
                color={done || current ? 'white' : 'text.muted'}
              >
                {current ? <Spinner size="xs" /> : done ? '✓' : i + 1}
              </Circle>
              <Text fontSize="sm" color={current ? 'chakra-body-text' : 'text.muted'} fontWeight={current ? 'semibold' : 'normal'}>
                {step.label}
              </Text>
            </HStack>
          );
        })}
      </Stack>
    </VStack>
  );
}

export default RoastLoader;
