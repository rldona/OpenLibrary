import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axe from 'axe-core';
import { I18nProvider } from '../src/i18n';
import { SnackbarProvider } from '../src/components/snackbar';

localStorage.setItem('ol.lang', 'en');

/** Renders inside the app's providers; `rerender` keeps them (they are a wrapper). */
export function renderUi(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <I18nProvider>
        <SnackbarProvider>{children}</SnackbarProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
  return render(ui, { wrapper });
}

/** Makes the window match the given width for `matchMedia` (jsdom has no layout). */
export function setWidth(px: number) {
  const matches = (query: string) => {
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    const min = /min-width:\s*([\d.]+)px/.exec(query);
    return (!max || px <= Number(max[1])) && (!min || px >= Number(min[1]));
  };
  window.matchMedia = (query: string) =>
    ({
      matches: matches(query),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

/** axe-core violations, without the rules jsdom cannot evaluate (it does not lay out or paint). */
export async function axeViolations(node: Element) {
  const r = await axe.run(node, { rules: { 'color-contrast': { enabled: false } } });
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}
