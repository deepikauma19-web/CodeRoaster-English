import { Box, Text } from '@chakra-ui/react';
import { motion } from 'framer-motion';
import { useRef, useState } from 'react';
import roasterGirl from '../../assets/roaster-girl.webp';
import { useCursorVector, type CursorVector } from '../../hooks/useCursorVector';

const FOLLOW_SPRING = { type: 'spring', stiffness: 110, damping: 16, mass: 0.7 } as const;

const GREETING = 'Welcome! Paste your repo and I will roast it 🔥';
const HOVER_LINE = 'Still staring at me? Sign in and see your score! 😄';

/** Eye geometry in the cropped photo's coordinate space. */
const PHOTO_W = 1400;
const PHOTO_H = 1620;
const SCLERA = '#f4eceb';

interface Eye {
  id: string;
  /** Iris centre. */
  cx: number;
  cy: number;
  /** Iris radius. */
  r: number;
  /** Eye-opening ellipse (keeps the moving iris inside the lids), rotated by `angle` degrees. */
  openCx: number;
  openCy: number;
  openRx: number;
  openRy: number;
  angle: number;
}

const EYES: Eye[] = [
  { id: 'left', cx: 721, cy: 272, r: 15.5, openCx: 721, openCy: 273, openRx: 26, openRy: 12.5, angle: 6 },
  { id: 'right', cx: 841, cy: 258, r: 15.5, openCx: 840, openCy: 260, openRx: 28, openRy: 13, angle: -8 },
];

const eyeTransform = (eye: Eye): string => `rotate(${eye.angle} ${eye.openCx} ${eye.openCy})`;

/** Where the cursor vector is measured from: between her eyes, as a fraction of the photo. */
const EYE_ANCHOR: CursorVector = { x: 781 / PHOTO_W, y: 265 / PHOTO_H };
/**
 * Head/body split (photo y). The body layer is erased above `BODY_FADE_*`, the head layer fades out
 * below `HEAD_FADE_*`; the two overlap across the neck so no seam shows while the head leans.
 */
const BODY_FADE_START = 440;
const BODY_FADE_END = 470;
const HEAD_FADE_START = 470;
const HEAD_FADE_END = 520;
/** The head pivots here (base of the neck) as a fraction of the photo. */
const NECK_PIVOT = { x: 781 / PHOTO_W, y: HEAD_FADE_START / PHOTO_H };
/** Max head lean in degrees / shift in photo pixels. */
const TILT_DEG = 5;
const SHIFT_X = 6;
const SHIFT_Y = 3;
/** Max iris travel in photo pixels. */
const TRAVEL_X = 9;
const TRAVEL_Y = 4.5;

/**
 * Landing-page presenter. Her head (a feathered cut-out of the photo) leans toward the cursor
 * from the neck, and her irises slide toward it too (each iris is cut from the photo itself and
 * clipped to the eye opening). The body stays still.
 * The speech bubble reacts to hover. Motion is disabled by `useCursorVector`
 * when the user prefers reduced motion.
 */
export function RoasterMascot() {
  const portraitRef = useRef<HTMLDivElement>(null);
  const look = useCursorVector(portraitRef, EYE_ANCHOR, 320);
  const [hovered, setHovered] = useState(false);

  return (
    <Box
      position="relative"
      w="full"
      maxW="360px"
      mx="auto"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <Box
        position={{ base: 'relative', lg: 'absolute' }}
        top={{ lg: '2%' }}
        left={{ lg: '-24%' }}
        w={{ base: 'full', lg: '66%' }}
        zIndex={1}
        bg="white"
        color="gray.800"
        borderWidth="1px"
        borderColor="border.subtle"
        borderRadius="2xl"
        boxShadow="md"
        px={3}
        py={2}
        mb={{ base: 3, lg: 0 }}
        _after={{
          content: '""',
          position: 'absolute',
          bottom: '-8px',
          left: { base: '30%', lg: '78%' },
          w: '16px',
          h: '16px',
          bg: 'white',
          borderRightWidth: '1px',
          borderBottomWidth: '1px',
          borderColor: 'border.subtle',
          transform: 'rotate(45deg)',
        }}
      >
        <Text fontWeight="semibold" fontSize="md" aria-live="polite">
          {hovered ? HOVER_LINE : GREETING}
        </Text>
      </Box>

      <Box ref={portraitRef} position="relative">
        <Box
          as="svg"
          viewBox={`0 0 ${PHOTO_W} ${PHOTO_H}`}
          display="block"
          w="full"
          h="auto"
          role="img"
          aria-label="Cartoon illustration of a smiling young woman with long wavy hair, sitting cross-legged"
        >
          <defs>
            <linearGradient
              id="rm-body-fade"
              gradientUnits="userSpaceOnUse"
              x1={0}
              y1={BODY_FADE_START}
              x2={0}
              y2={BODY_FADE_END}
            >
              <stop offset="0" stopColor="#000" />
              <stop offset="1" stopColor="#fff" />
            </linearGradient>
            <linearGradient
              id="rm-head-fade"
              gradientUnits="userSpaceOnUse"
              x1={0}
              y1={HEAD_FADE_START}
              x2={0}
              y2={HEAD_FADE_END}
            >
              <stop offset="0" stopColor="#fff" />
              <stop offset="1" stopColor="#000" />
            </linearGradient>
            <radialGradient id="rm-ground-shadow">
              <stop offset="0" stopColor="#5a2a14" stopOpacity="0.28" />
              <stop offset="1" stopColor="#5a2a14" stopOpacity="0" />
            </radialGradient>
            <mask id="rm-body-mask" maskUnits="userSpaceOnUse" x={0} y={-300} width={PHOTO_W} height={PHOTO_H + 600}>
              <rect x={0} y={-300} width={PHOTO_W} height={PHOTO_H + 600} fill="url(#rm-body-fade)" />
            </mask>
            <mask id="rm-head-mask" maskUnits="userSpaceOnUse" x={0} y={-300} width={PHOTO_W} height={PHOTO_H + 600}>
              <rect x={0} y={-300} width={PHOTO_W} height={PHOTO_H + 600} fill="url(#rm-head-fade)" />
            </mask>
            <linearGradient id="rm-lid-shadow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#2a1a18" stopOpacity="0.5" />
              <stop offset="0.5" stopColor="#2a1a18" stopOpacity="0" />
            </linearGradient>
            {EYES.map((eye) => (
              <g key={eye.id}>
                <clipPath id={`rm-open-${eye.id}`}>
                  <ellipse cx={eye.openCx} cy={eye.openCy} rx={eye.openRx} ry={eye.openRy} transform={eyeTransform(eye)} />
                </clipPath>
                <clipPath id={`rm-iris-${eye.id}`}>
                  <circle cx={eye.cx} cy={eye.cy} r={eye.r} />
                </clipPath>
              </g>
            ))}
          </defs>

          <ellipse cx={690} cy={PHOTO_H - 50} rx={470} ry={46} fill="url(#rm-ground-shadow)" />

          <g mask="url(#rm-body-mask)">
            <image href={roasterGirl} x={0} y={0} width={PHOTO_W} height={PHOTO_H} />
          </g>


          <g mask="url(#rm-head-mask)">
            <motion.g
              initial={{ originX: NECK_PIVOT.x, originY: NECK_PIVOT.y }}
              animate={{ rotate: look.x * TILT_DEG, x: look.x * SHIFT_X, y: look.y * SHIFT_Y }}
              transition={FOLLOW_SPRING}
            >
              <image href={roasterGirl} x={0} y={0} width={PHOTO_W} height={PHOTO_H} />
              {EYES.map((eye) => (
                <g key={eye.id} clipPath={`url(#rm-open-${eye.id})`}>
                  <ellipse
                    cx={eye.openCx}
                    cy={eye.openCy}
                    rx={eye.openRx}
                    ry={eye.openRy}
                    transform={eyeTransform(eye)}
                    fill={SCLERA}
                  />
                  <motion.g animate={{ x: look.x * TRAVEL_X, y: look.y * TRAVEL_Y }} transition={FOLLOW_SPRING}>
                    <g clipPath={`url(#rm-iris-${eye.id})`}>
                      <image href={roasterGirl} x={0} y={0} width={PHOTO_W} height={PHOTO_H} />
                    </g>
                  </motion.g>
                  <ellipse
                    cx={eye.openCx}
                    cy={eye.openCy}
                    rx={eye.openRx}
                    ry={eye.openRy}
                    transform={eyeTransform(eye)}
                    fill="url(#rm-lid-shadow)"
                  />
                </g>
              ))}
            </motion.g>
          </g>
        </Box>
      </Box>
    </Box>
  );
}

export default RoasterMascot;
