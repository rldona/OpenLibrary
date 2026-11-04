import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CopyDTO, EditionDTO, WorkDTO } from '@openlibrary/contracts';
import { api, ApiError, errorText } from './api';
import { Icon } from './components/ui';
import { navigate, setParams, useLocation } from './lib/router';
import { useLocations } from './lib/queries';
import { Library } from './pages/Library';
import { Locations } from './pages/Locations';
import { Settings } from './pages/Settings';
import { BookDrawer } from './pages/BookDrawer';
import { BookForm } from './pages/BookForm';
import { CopyForm, type CopyMode } from './pages/CopyForm';

type State = { phase: 'loading' } | { phase: 'anon' } | { phase: 'in' } | { phase: 'down'; message: string };

export function App() {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const qc = useQueryClient();

  const refresh = useCallback(async () => {
    try {
      await api.me();
      setState({ phase: 'in' });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState({ phase: 'anon' });
      else setState({ phase: 'down', message: errorText(e) });
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(() => {
    qc.clear();
    setState({ phase: 'anon' });
  }, [qc]);

  if (state.phase === 'loading') return <p className="muted center pad">Cargando…</p>;
  if (state.phase === 'down')
    return (
      <div className="center-card">
        <div className="panel narrow">
          <h1>Servidor no disponible</h1>
          <p className="muted">{state.message}</p>
          <button className="btn" onClick={() => void refresh()}>
            Reintentar
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
  const { path, params } = useLocation();
  const [dialog, setDialog] = useState<Dialog>(null);
  const locs = useLocations();
  const view = path.startsWith('/ubicaciones')
    ? 'locations'
    : path.startsWith('/ajustes')
      ? 'settings'
      : 'library';

  // Si la sesión caduca, cualquier 401 devuelve al login.
  const qc = useQueryClient();
  useEffect(
    () =>
      qc.getQueryCache().subscribe((ev) => {
        const err = ev.query.state.error;
        if (err instanceof ApiError && err.status === 401) onLogout();
      }),
    [qc, onLogout],
  );

  const addBook = () => setDialog({ kind: 'book', mode: { kind: 'add' } });
  const actions = {
    editBook: (work: WorkDTO, edition: EditionDTO) =>
      setDialog({ kind: 'book', mode: { kind: 'edit', work, edition } }),
    newEdition: (work: WorkDTO) => setDialog({ kind: 'book', mode: { kind: 'edition', work } }),
    addCopy: (editionId: string, title: string) =>
      setDialog({ kind: 'copy', mode: { kind: 'add', editionId, title } }),
    editCopy: (copy: CopyDTO) => setDialog({ kind: 'copy', mode: { kind: 'edit', copy } }),
    retireCopy: (copy: CopyDTO) => setDialog({ kind: 'copy', mode: { kind: 'retire', copy } }),
  };

  async function logout() {
    await api.logout().catch(() => undefined);
    onLogout();
  }

  const nav = (to: string, v: string, icon: string, label: string, n?: number) => (
    <a
      href={to}
      className={`nav ${view === v ? 'on' : ''}`}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      <Icon name={icon} />
      <span>{label}</span>
      {n !== undefined && <span className="n">{n}</span>}
    </a>
  );

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <span className="logo" aria-hidden>
            <Icon name="book" size={18} />
          </span>
          OpenLibrary
        </div>
        {nav('/', 'library', 'book', 'Biblioteca')}
        {nav('/ubicaciones', 'locations', 'tree', 'Ubicaciones', locs.data?.items.length)}
        <div className="sep" />
        {nav('/ajustes', 'settings', 'gear', 'Ajustes')}
        <button className="nav" onClick={() => void logout()}>
          <Icon name="logout" />
          <span>Cerrar sesión</span>
        </button>
        <div className="foot">Próximamente: lectura, deseos, estadísticas e importación.</div>
      </aside>
      <main>
        <header className="top">
          <SearchBox
            value={params.get('q') ?? ''}
            onSearch={(q) =>
              view === 'library'
                ? setParams({ q }, { replace: true })
                : navigate(q ? `/?q=${encodeURIComponent(q)}` : '/')
            }
          />
          <button className="btn primary" onClick={addBook}>
            <Icon name="plus" size={16} />
            <span className="hide-sm">Añadir libro</span>
          </button>
        </header>
        <section className="view">
          {view === 'library' && <Library onAdd={addBook} />}
          {view === 'locations' && <Locations />}
          {view === 'settings' && <Settings onLogout={onLogout} />}
        </section>
      </main>
      <BookDrawer {...actions} />
      {dialog?.kind === 'book' && (
        <BookForm
          mode={dialog.mode}
          onClose={() => setDialog(null)}
          onAddCopy={(id) =>
            setDialog({
              kind: 'copy',
              mode: { kind: 'add', editionId: id, title: 'la edición que ya tienes' },
            })
          }
        />
      )}
      {dialog?.kind === 'copy' && <CopyForm mode={dialog.mode} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** Búsqueda con espera de 250 ms para no lanzar una petición por tecla. Atajo: «/». */
function SearchBox({ value, onSearch }: { value: string; onSearch: (q: string) => void }) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const timer = useRef<number>(undefined);
  // La URL manda (atrás/adelante, «Limpiar filtros»), salvo mientras escribes en el buscador.
  useEffect(() => {
    if (document.activeElement !== ref.current) setText(value);
  }, [value]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="search">
      <Icon name="search" size={17} />
      <input
        ref={ref}
        type="search"
        value={text}
        placeholder="Busca por título, autor, ISBN, editorial, género o ubicación…"
        aria-label="Buscar en la biblioteca"
        onChange={(e) => {
          setText(e.target.value);
          clearTimeout(timer.current);
          const q = e.target.value.trim();
          timer.current = window.setTimeout(() => onSearch(q), 250);
        }}
      />
      <kbd>/</kbd>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
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
      setError(errorText(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-card">
      <form className="panel narrow" onSubmit={submit}>
        <div className="brand">
          <span className="logo" aria-hidden>
            <Icon name="book" size={18} />
          </span>
          OpenLibrary
        </div>
        <h1>Tu biblioteca</h1>
        <p className="muted">Biblioteca privada. Introduce tu contraseña para continuar.</p>
        <label>
          Contraseña
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
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
