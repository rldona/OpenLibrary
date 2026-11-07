import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { SnackbarProvider } from './components/snackbar';
import { I18nProvider } from './i18n';
import { ApiError } from './api';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // Do not retry client errors (401, 404…): only network/server failures.
      retry: (n, e) => n < 2 && !(e instanceof ApiError && e.status < 500),
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <SnackbarProvider>
          <App />
        </SnackbarProvider>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
