import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CopyDTO, EditionDTO, WorkDTO } from '@openlibrary/contracts/client';
import { api, ApiError, errorText } from './api';
import { Icon, Logo } from './components/ui';
import { MainNav, type View } from './components/nav';
import { SearchBox } from './components/search';
import { useNavMode } from './lib/media';
import { SIGN_OUT_FLUSH_MS, useSnackbar } from './components/snackbar';
import { useDocumentTitle } from './lib/title';
import { navigate, setParams, useLocation } from './lib/router';
import { useLocations, useWishlist } from './lib/queries';
import { LanguageSwitch, useI18n } from './i18n';
import { Library } from './pages/Library';
import { Locations } from './pages/Locations';
import { Settings } from './pages/Settings';
import { Wishlist } from './pages/Wishlist';
import { Stats } from './pages/Stats';
import { Data } from './pages/Data';
import { BookDrawer } from './pages/BookDrawer';
import { BookForm } from './pages/BookForm';
import { CopyForm, type CopyMode } from './pages/CopyForm';

type State = { phase: 'loading' } | { phase: 'anon' } | { phase: 'in' } | { phase: 'down'; message: string };

export function App() {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ phase: 'loading' });
  const qc = useQueryClient();

  const refresh = useCallback(async () => {
    try {
      await api.me();
      setState({ phase: 'in' });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState({ phase: 'anon' });
      else setState({ phase: 'down', message: errorText(e, t) });
    }
    // Only on mount / retry; the message language is not worth a re-check.
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(() => {
    qc.clear();
    setState({ phase: 'anon' });
  }, [qc]);

  if (state.phase === 'loading') return <p className="muted center pad">{t('common.loading')}</p>;
  if (state.phase === 'down')
    return (
      <div className="center-card">
        <div className="panel narrow">
          <h1>{t('app.serverDown')}</h1>
          <p className="muted">{state.message}</p>
          <button className="btn" onClick={() => void refresh()}>
            {t('common.retry')}
          </button>
        </div>
      </div>
    );
  if (state.phase === 'anon') return <Login onDone={() => setState({ phase: 'in' })} />;
  return <Shell onLogout={logout} />;
}

type Dialog =
  { kind: 'book'; mode: Parameters<typeof BookForm>[0]['mode'] } | { kind: 'copy'; mode: CopyMode } | null;

function Shell({ onLogout }: { onLogout: () => void }) {
  const { t } = useI18n();
  const { path, params } = useLocation();
  const [dialog, setDialog] = useState<Dialog>(null);
  const locs = useLocations();
  const wishes = useWishlist();
  const mode = useNavMode();
  const view: View = path.startsWith('/locations')
    ? 'locations'
    : path.startsWith('/wishlist')
      ? 'wishlist'
      : path.startsWith('/stats')
        ? 'stats'
        : path.startsWith('/data')
          ? 'data'
          : path.startsWith('/settings')
            ? 'settings'
            : 'library';
  const viewTitle = {
    library: t('nav.library'),
    locations: t('nav.locations'),
    wishlist: t('nav.wishlist'),
    stats: t('nav.stats'),
    data: t('nav.data'),
    settings: t('nav.settings'),
  }[view];
  useDocumentTitle(viewTitle);
  // Moving to another view puts the focus on its heading, as a page load would; filters do not move it.
  const shownView = useRef(view);
  useEffect(() => {
    if (shownView.current === view) return;
    shownView.current = view;
    document.querySelector<HTMLElement>('#content h1')?.focus();
  }, [view]);
  const { flush } = useSnackbar();

  // If the session expires, any 401 goes back to the login screen, after trying the pending deletions.
  const qc = useQueryClient();
  useEffect(
    () =>
      qc.getQueryCache().subscribe((ev) => {
        const err = ev.query.state.error;
        if (err instanceof ApiError && err.status === 401)
          void flush({ timeoutMs: SIGN_OUT_FLUSH_MS }).finally(onLogout);
      }),
    [qc, onLogout, flush],
  );

  const addBook = () => setDialog({ kind: 'book', mode: { kind: 'add' } });
  const boughtWish = (w: {
    id: string;
    title: string;
    authors: string[];
    isbn13: string | null;
    coverAssetId: string | null;
  }) =>
    setDialog({
      kind: 'book',
      mode: {
        kind: 'add',
        prefill: {
          wishId: w.id,
          title: w.title,
          authors: w.authors,
          isbn: w.isbn13 ?? undefined,
          coverAssetId: w.coverAssetId ?? undefined,
        },
      },
    });
  const actions = {
    editBook: (work: WorkDTO, edition: EditionDTO) =>
      setDialog({ kind: 'book', mode: { kind: 'edit', work, edition } }),
    newEdition: (work: WorkDTO) => setDialog({ kind: 'book', mode: { kind: 'edition', work } }),
    addCopy: (editionId: string, title: string) =>
      setDialog({ kind: 'copy', mode: { kind: 'add', editionId, title } }),
    editCopy: (copy: CopyDTO) => setDialog({ kind: 'copy', mode: { kind: 'edit', copy } }),
    retireCopy: (copy: CopyDTO) => setDialog({ kind: 'copy', mode: { kind: 'retire', copy } }),
  };

  const nav = (
    <MainNav
      mode={mode}
      view={view}
      counts={{
        locations: locs.data?.items.length,
        wishlist: wishes.data?.items.filter((w) => w.status === 'open').length,
      }}
      onSignOut={() => void logout()}
    />
  );

  async function logout() {
    // Deletions still waiting for "Undo" reach the server while the session is valid.
    await flush({ timeoutMs: SIGN_OUT_FLUSH_MS });
    await api.logout().catch(() => undefined);
    onLogout();
  }

  return (
    <div className={`app nav-${mode}`}>
      <a className="skip" href="#content">
        {t('a11y.skipToContent')}
      </a>
      {mode !== 'bar' && nav}
      <main>
        <header className="top">
          <SearchBox
            value={params.get('q') ?? ''}
            live={view === 'library'}
            onSearch={(q) =>
              view === 'library'
                ? setParams({ q }, { replace: true })
                : navigate(q ? `/?q=${encodeURIComponent(q)}` : '/')
            }
          />
          {mode !== 'bar' && (
            <button className="btn primary" onClick={addBook}>
              <Icon name="plus" size={16} />
              {t('book.add')}
            </button>
          )}
        </header>
        <section className="view" id="content" tabIndex={-1}>
          {view === 'library' && <Library onAdd={addBook} />}
          {view === 'locations' && <Locations />}
          {view === 'wishlist' && <Wishlist onBought={boughtWish} />}
          {view === 'stats' && <Stats />}
          {view === 'data' && <Data />}
          {view === 'settings' && (
            <Settings onLogout={onLogout} onSignOut={() => void logout()} compact={mode === 'bar'} />
          )}
        </section>
      </main>
      {mode === 'bar' && (
        <>
          {/* Material's FAB for the main action, above the navigation bar. */}
          <button className="fab" onClick={addBook} aria-label={t('book.add')}>
            <Icon name="plus" size={24} />
          </button>
          {nav}
        </>
      )}
      <BookDrawer {...actions} />
      {dialog?.kind === 'book' && (
        <BookForm
          mode={dialog.mode}
          onClose={() => setDialog(null)}
          onAddCopy={(id, wishId) =>
            setDialog({ kind: 'copy', mode: { kind: 'add', editionId: id, wishId } })
          }
        />
      )}
      {dialog?.kind === 'copy' && <CopyForm mode={dialog.mode} onClose={() => setDialog(null)} />}
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login({ password });
      onDone();
    } catch (err) {
      setError(errorText(err, t));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-card">
      <form className="panel narrow" onSubmit={submit}>
        <div className="row-between">
          <div className="brand">
            <Logo className="logo" />
            OpenLibrary
          </div>
          <LanguageSwitch />
        </div>
        <h1>{t('login.title')}</h1>
        <p className="muted">{t('login.subtitle')}</p>
        <label>
          {t('login.password')}
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary block" disabled={busy || !password}>
          {busy ? t('login.signingIn') : t('login.signIn')}
        </button>
      </form>
    </div>
  );
}
