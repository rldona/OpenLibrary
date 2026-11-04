import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PASSWORD_MIN_LENGTH, type Device } from '@openlibrary/contracts';
import { api, errorText } from '../api';
import { useToast } from '../components/ui';
import { fmtDateTime } from '../lib/format';

export function Settings({ onLogout }: { onLogout: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const health = useQuery({ queryKey: ['health'], queryFn: api.health });
  const devices = useQuery({ queryKey: ['devices'], queryFn: api.devices });

  async function revoke(d: Device) {
    if (!confirm(`¿Revocar el acceso de «${d.name}»? Tendrá que volver a iniciar sesión.`)) return;
    try {
      await api.revoke(d.id);
      if (d.current) return onLogout();
      void qc.invalidateQueries({ queryKey: ['devices'] });
      toast(`Acceso de «${d.name}» revocado`);
    } catch (e) {
      toast(errorText(e));
    }
  }

  return (
    <>
      <div className="vh">
        <div>
          <h1>Ajustes</h1>
          <p className="sub">Servidor, sesiones y seguridad.</p>
        </div>
      </div>
      <div className="stack">
        <section className="panel">
          <h3>Servidor</h3>
          {health.data && (
            <dl className="kv">
              <div>
                <dt>Estado</dt>
                <dd>
                  <span className="dot" /> En línea
                </dd>
              </div>
              <div>
                <dt>Versión</dt>
                <dd>{health.data.version}</dd>
              </div>
              <div>
                <dt>Hora del servidor</dt>
                <dd>{fmtDateTime(health.data.time)}</dd>
              </div>
              <div>
                <dt>Epoch de datos</dt>
                <dd className="mono">{health.data.epoch.slice(0, 8)}</dd>
              </div>
            </dl>
          )}
        </section>

        <section className="panel">
          <h3>Sesiones y dispositivos</h3>
          <p className="muted">
            Cada navegador y cada móvil tienen su propio acceso. Si pierdes el teléfono, revócalo aquí.
          </p>
          <ul className="list">
            {devices.data?.items.map((d) => (
              <li key={d.id}>
                <div>
                  <b>{d.name}</b> {d.current && <span className="badge accent">esta sesión</span>}
                  <div className="muted small">
                    {d.kind === 'device' ? `Dispositivo ${d.platform}` : 'Navegador'} · creado{' '}
                    {fmtDateTime(d.createdAt)} · último uso {fmtDateTime(d.lastSeenAt)}
                  </div>
                </div>
                <button className="btn sm ghost danger" onClick={() => void revoke(d)}>
                  Revocar
                </button>
              </li>
            ))}
          </ul>
        </section>

        <ChangePassword />
      </div>
    </>
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
    <form className="panel" onSubmit={submit}>
      <h3>Cambiar contraseña</h3>
      <div className="fgrid three">
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
      {msg && <p className={msg.ok ? 'ok' : 'err'}>{msg.text}</p>}
      <button className="btn">Cambiar contraseña</button>
    </form>
  );
}
