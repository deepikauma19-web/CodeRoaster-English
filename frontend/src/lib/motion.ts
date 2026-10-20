/**
 * HTML event props whose signatures clash with Framer Motion's props.
 * Omit them from Chakra props before spreading onto a `motion.create(Chakra)` component.
 */
export type MotionConflictingProps =
  | 'transition'
  | 'onAnimationStart'
  | 'onAnimationEnd'
  | 'onAnimationIteration'
  | 'onDrag'
  | 'onDragStart'
  | 'onDragEnd'
  | 'onDragEnter'
  | 'onDragLeave'
  | 'onDragOver'
  | 'onDrop';

export type MotionSafe<P> = Omit<P, MotionConflictingProps>;
