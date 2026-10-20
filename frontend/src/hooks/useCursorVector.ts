import { useReducedMotion } from 'framer-motion';
import { useEffect, useState, type RefObject } from 'react';

export interface CursorVector {
  /** -1 (cursor far left of the anchor) … 1 (far right). */
  x: number;
  /** -1 (cursor far above the anchor) … 1 (far below). */
  y: number;
}

const ZERO: CursorVector = { x: 0, y: 0 };

const clamp = (value: number): number => Math.max(-1, Math.min(1, value));

/**
 * Tracks the pointer and returns its direction relative to a point inside `ref`.
 *
 * @param ref Element the vector is measured from.
 * @param anchor Point inside the element as a 0–1 fraction (default: its centre).
 * @param reach Distance in px at which the vector saturates to ±1.
 */
export function useCursorVector(
  ref: RefObject<Element>,
  anchor: CursorVector = { x: 0.5, y: 0.5 },
  reach = 360,
): CursorVector {
  const reduceMotion = useReducedMotion() ?? false;
  const [vector, setVector] = useState<CursorVector>(ZERO);
  const anchorX = anchor.x;
  const anchorY = anchor.y;

  useEffect(() => {
    if (reduceMotion) return undefined;
    let frame = 0;

    const onMove = (event: PointerEvent): void => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width * anchorX;
        const cy = rect.top + rect.height * anchorY;
        setVector({ x: clamp((event.clientX - cx) / reach), y: clamp((event.clientY - cy) / reach) });
      });
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ref, anchorX, anchorY, reach, reduceMotion]);

  return reduceMotion ? ZERO : vector;
}
