import { extendTheme, type ThemeConfig } from '@chakra-ui/react';

const config: ThemeConfig = {
  initialColorMode: 'light',
  useSystemColorMode: false,
};

/** Brand palette: electric lime (the highlight colour). Always put dark ink text on it. */
const brand = {
  50: '#f8fde3',
  100: '#eefbb8',
  200: '#e4f88a',
  300: '#dbf560',
  400: '#d4f23c',
  500: '#c8ea1c',
  600: '#a3b814',
  700: '#7d8c10',
  800: '#59630c',
  900: '#3a4108',
};

/** Ink palette: near-black used for primary buttons, text and dark surfaces. */
const ink = {
  50: '#f4f4f2',
  100: '#e6e6e3',
  200: '#cfcfcb',
  300: '#a9a9a4',
  400: '#6a6a66',
  500: '#0a0a0a',
  600: '#262626',
  700: '#3a3a3a',
  800: '#161616',
  900: '#0a0a0a',
};

const theme = extendTheme({
  config,
  colors: {
    brand,
    ink,
  },
  fonts: {
    heading: `'Plus Jakarta Sans', 'Inter', system-ui, sans-serif`,
    body: `'Inter', system-ui, sans-serif`,
    display: `'Space Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace`,
    mono: `'Space Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace`,
  },
  semanticTokens: {
    colors: {
      'bg.canvas': { default: '#f4f4f2', _dark: 'ink.800' },
      'bg.surface': { default: 'white', _dark: 'ink.800' },
      'bg.card': { default: 'white', _dark: 'whiteAlpha.50' },
      'bg.subtle': { default: 'ink.50', _dark: 'whiteAlpha.100' },
      'bg.track': { default: 'ink.100', _dark: 'whiteAlpha.200' },
      'bg.code': { default: 'ink.50', _dark: 'blackAlpha.400' },
      'bg.header': { default: 'rgba(244, 244, 242, 0.85)', _dark: 'blackAlpha.600' },
      'border.subtle': { default: 'ink.100', _dark: 'whiteAlpha.200' },
      'text.muted': { default: 'ink.400', _dark: 'whiteAlpha.700' },
      'accent.fire': { default: 'ink.500', _dark: 'brand.400' },
    },
  },
  styles: {
    global: {
      'html, body': {
        bg: 'bg.canvas',
        color: 'ink.500',
        minHeight: '100%',
      },
      body: {
        WebkitFontSmoothing: 'antialiased',
      },
      '::selection': {
        bg: 'brand.400',
        color: 'ink.500',
      },
    },
  },
  components: {
    Button: {
      defaultProps: { colorScheme: 'ink' },
      baseStyle: { borderRadius: 'full', fontWeight: 600 },
    },
    Heading: {
      baseStyle: { letterSpacing: '-0.03em', fontWeight: 800 },
    },
    Badge: {
      baseStyle: { textTransform: 'none', fontWeight: 600 },
    },
  },
});

export default theme;
