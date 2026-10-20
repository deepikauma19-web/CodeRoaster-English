import { ChakraProvider } from '@chakra-ui/react';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext } from '../../context/authContextObject';
import theme from '../../theme';
import type { AuthContextValue } from '../../types/auth';
import { makeAuthValue } from './fixtures';
import { LocationProbe } from './LocationProbe';


export interface RenderOptions {
  /** Initial URL. */
  route?: string;
  /** Route pattern the UI is mounted at (defaults to `route`). */
  path?: string;
  /** Extra routes (e.g. redirect targets). */
  extraRoutes?: ReactNode;
  /** Auth context to provide. Defaults to logged out. */
  auth?: AuthContextValue;
}

/** Chakra + MemoryRouter + a static AuthContext value. */
export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}): RenderResult {
  const { route = '/', path, extraRoutes, auth = makeAuthValue() } = options;
  return render(
    <ChakraProvider theme={theme}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path={path ?? route.split('?')[0].split('#')[0]} element={ui} />
            {extraRoutes}
            <Route path="*" element={<div data-testid="unmatched-route" />} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </AuthContext.Provider>
    </ChakraProvider>,
  );
}

/** Chakra only (pure presentational components). */
export function renderWithChakra(ui: ReactElement): RenderResult {
  return render(<ChakraProvider theme={theme}>{ui}</ChakraProvider>);
}
