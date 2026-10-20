import { Box, Text, VStack, chakra, useToken } from '@chakra-ui/react';
import { animate, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { SCORE_MAX, getScoreBand } from '../../lib/score';

export interface ScoreGaugeProps {
  /** Overall score 0–100. */
  score: number;
  /** Diameter in px. */
  size?: number;
  /** Animate 0 → score (ignored when the user prefers reduced motion). */
  animated?: boolean;
}

const STROKE = 12;

const clamp = (n: number): number => Math.min(SCORE_MAX, Math.max(0, Math.round(n)));

/** Circular score gauge coloured by score band. Pure presentational. */
export function ScoreGauge({ score, size = 200, animated = true }: ScoreGaugeProps) {
  const target = clamp(score);
  const band = getScoreBand(target);
  const reduceMotion = useReducedMotion() ?? false;
  const shouldAnimate = animated && !reduceMotion;
  const [animatedValue, setAnimatedValue] = useState<number>(0);
  const display = shouldAnimate ? animatedValue : target;
  const [trackColor, bandColor] = useToken('colors', ['bg.track', `${band.colorScheme}.400`]);

  useEffect(() => {
    if (!shouldAnimate) return undefined;
    const controls = animate(0, target, {
      duration: 1.4,
      ease: 'easeOut',
      onUpdate: (v: number) => setAnimatedValue(Math.round(v)),
    });
    return () => controls.stop();
  }, [target, shouldAnimate]);

  const radius = (size - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - display / SCORE_MAX);

  return (
    <VStack spacing={2} data-testid="score-gauge">
      <Box position="relative" w={`${size}px`} h={`${size}px`}>
        <chakra.svg
          viewBox={`0 0 ${size} ${size}`}
          w="full"
          h="full"
          transform="rotate(-90deg)"
          role="img"
          aria-label={`Score ${target} out of ${SCORE_MAX}: ${band.label}`}
        >
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={trackColor} strokeWidth={STROKE} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={bandColor}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </chakra.svg>
        <VStack position="absolute" inset={0} justify="center" spacing={0} aria-hidden="true">
          <Text fontSize={size >= 180 ? '5xl' : '3xl'} fontWeight="extrabold" fontFamily="heading" lineHeight="1">
            {display}
          </Text>
          <Text fontSize="sm" color="text.muted">
            / {SCORE_MAX}
          </Text>
        </VStack>
      </Box>
      <Text fontWeight="bold" fontSize="lg" color={`${band.colorScheme}.300`} data-testid="score-band">
        {band.label}
      </Text>
    </VStack>
  );
}

export default ScoreGauge;
