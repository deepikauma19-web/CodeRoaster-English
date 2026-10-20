import { Box } from '@chakra-ui/react';
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';

const MotionBox = motion.create(Box);
const SIZE = 130;

interface Point {
  x: number;
  y: number;
}

/** Soft pastel glow that follows the mouse. Hidden on touch devices and for reduced motion. */
export function CursorGlow() {
  const reduceMotion = useReducedMotion() ?? false;
  const [point, setPoint] = useState<Point | null>(null);

  useEffect(() => {
    const finePointer = window.matchMedia('(pointer: fine)').matches;
    if (reduceMotion || !finePointer) return undefined;
    let frame = 0;

    const onMove = (event: PointerEvent): void => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setPoint({ x: event.clientX, y: event.clientY });
      });
    };
    const onLeave = (): void => setPoint(null);

    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [reduceMotion]);

  if (!point) return null;

  return (
    <MotionBox
      aria-hidden="true"
      position="fixed"
      top={0}
      left={0}
      w={`${SIZE}px`}
      h={`${SIZE}px`}
      borderRadius="full"
      pointerEvents="none"
      zIndex={0}
      bgGradient="radial(rgba(212, 242, 60, 0.35), rgba(212, 242, 60, 0.12) 45%, transparent 70%)"
      filter="blur(6px)"
      initial={{ opacity: 0, x: point.x - SIZE / 2, y: point.y - SIZE / 2 }}
      animate={{ opacity: 1, x: point.x - SIZE / 2, y: point.y - SIZE / 2 }}
      transition={{ type: 'spring', stiffness: 140, damping: 20, mass: 0.6 }}
    />
  );
}

export default CursorGlow;
