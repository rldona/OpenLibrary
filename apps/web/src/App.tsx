import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { PASSWORD_MIN_LENGTH, type Device, type HealthResponse } from '@openlibrary/contracts';
import { api, ApiError } from './api';

type State = { phase: 'loading' } | { phase: 'anon' } | { phase: 'in' } | { phase: 'down'; message: string };

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429 && e.problem.retryAfterSeconds) {
      const s = e.problem.retryAfterSeconds;
      return `Demasiados intentos. Vuelve a probar en ${s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`}.`;
    }
    return e.message;
  }
  return 'No se puede contactar con el servidor.';
}

export function App() {
  const [state, setState] = useState<State>({ phase: 'loading' });

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

  return (
    <div className="shell">
      <header className="brand">
        <span className="logo" aria-hidden>
          <svg viewBox="0 0 32 32">
            <path d="M7 9h6a3 3 0 0 1 3 3v12a2.5 2.5 0 0 0-2.5-2.5H7zM25 9h-6a3 3 0 0 0-3 3v12a2.5 2.5 0 0 1 2.5-2.5H25z" />
          </svg>
        </span>
        OpenLibrary
      </header>
      {state.phase === 'loading' && <p className="muted center">Cargando…</p>}
      {state.phase === 'down' && (
        <div className="card">
          <h1>Servidor no disponible</h1>
          <p className="muted">{state.message}</p>
          <button className="btn" onClick={() => void refresh()}>
            Reintentar
          </button>
        </div>
      )}
      {state.phase === 'anon' && <Login onDone={() => setState({ phase: 'in' })} />}
      {state.phase === 'in' && <Home onLogout={() => setState({ phase: 'anon' })} />}
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
    <form className="card narrow" onSubmit={submit}>
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
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary" disabled={busy || !password}>
        {busy ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}

function Home({ onLogout }: { onLogout: () => void }) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, d] = await Promise.all([api.health(), api.devices()]);
      setHealth(h);
      setDevices(d.items);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onLogout();
      else setError(errorText(e));
    }
  }, [onLogout]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(d: Device) {
    if (!confirm(`¿Revocar el acceso de «${d.name}»? Tendrá que volver a iniciar sesión.`)) return;
    await api.revoke(d.id);
    if (d.current) onLogout();
    else void load();
  }

  async function logout() {
    await api.logout().catch(() => undefined);
    onLogout();
  }

  return (
    <main className="stack">
      <div className="card">
        <div className="row">
          <h1>Todo listo</h1>
          <button className="btn" onClick={() => void logout()}>
            Cerrar sesión
          </button>
        </div>
        <p className="muted">
          La base del servidor funciona. El catálogo (obras, ediciones, ejemplares y ubicaciones) llega en la
          siguiente fase.
        </p>
        {health && (
          <dl className="kv">
            <div>
              <dt>Estado</dt>
              <dd>
                <span className="dot" /> En línea
              </dd>
            </div>
            <div>
              <dt>Versión</dt>
              <dd>{health.version}</dd>
            </div>
            <div>
              <dt>Hora del servidor</dt>
              <dd>{fmt(health.time)}</dd>
            </div>
            <div>
              <dt>Epoch de datos</dt>
              <dd className="mono">{health.epoch.slice(0, 8)}</dd>
            </div>
          </dl>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      <div className="card">
        <h2>Sesiones y dispositivos</h2>
        <p className="muted">
          Cada navegador y cada móvil tienen su propio acceso. Si pierdes el teléfono, revócalo aquí.
        </p>
        <ul className="list">
          {devices.map((d) => (
            <li key={d.id}>
              <div>
                <b>{d.name}</b> {d.current && <span className="tag">esta sesión</span>}
                <div className="muted small">
                  {d.kind === 'device' ? `Dispositivo ${d.platform}` : 'Navegador'} · creado{' '}
                  {fmt(d.createdAt)} · último uso {fmt(d.lastSeenAt)}
                </div>
              </div>
              <button className="btn ghost danger" onClick={() => void revoke(d)}>
                Revocar
              </button>
            </li>
          ))}
        </ul>
      </div>

      <ChangePassword />
    </main>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== repeat) return setMsg({ ok: false, text: 'Las contraseñas nuevas no coinciden.' });
    try {
      await api.changePassword({ current, next });
      setMsg({ ok: true, text: 'Contraseña cambiada. Se han cerrado las demás sesiones y dispositivos.' });
      setCurrent('');
      setNext('');
      setRepeat('');
    } catch (err) {
      setMsg({ ok: false, text: errorText(err) });
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Cambiar contraseña</h2>
      <div className="grid">
        <label>
          Actual
          <input
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label>
          Nueva (mín. {PASSWORD_MIN_LENGTH})
          <input
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        <label>
          Repítela
          <input
            type="password"
            autoComplete="new-password"
            required
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </label>
      </div>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}
      <button className="btn">Cambiar contraseña</button>
    </form>
  );
}
