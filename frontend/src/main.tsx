import { ChakraProvider } from '@chakra-ui/react';
import { StrictMode, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import theme from './theme';

/** The site is light-only: ignore any dark mode value saved in the browser by earlier versions. */
const lightOnlyColorMode: NonNullable<ComponentProps<typeof ChakraProvider>['colorModeManager']> = {
  type: 'localStorage',
  get: () => 'light',
  set: () => undefined,
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <ChakraProvider theme={theme} colorModeManager={lightOnlyColorMode}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ChakraProvider>
  </StrictMode>,
);
