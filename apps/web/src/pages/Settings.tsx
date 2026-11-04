import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LANGS, PASSWORD_MIN_LENGTH, type Device } from '@openlibrary/contracts';
import { api, errorText } from '../api';
import { useToast } from '../components/ui';
import { fmtDateTime } from '../lib/format';
import { LANG_NAMES, useI18n } from '../i18n';

export function Settings({ onLogout }: { onLogout: () => void }) {
  const { t, lang, setLang } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const health = useQuery({ queryKey: ['health'], queryFn: api.health });
  const devices = useQuery({ queryKey: ['devices'], queryFn: api.devices });

  async function revoke(d: Device) {
    const name = d.kind === 'web' ? t('settings.browser') : d.name;
    if (!confirm(t('settings.revokeConfirm', { name }))) return;
    try {
      await api.revoke(d.id);
      if (d.current) return onLogout();
      void qc.invalidateQueries({ queryKey: ['devices'] });
      toast(t('settings.revoked', { name }));
    } catch (e) {
      toast(errorText(e, t));
    }
  }

  return (
    <>
      <div className="vh">
        <div>
          <h1>{t('nav.settings')}</h1>
          <p className="sub">{t('settings.subtitle')}</p>
        </div>
      </div>
      <div className="stack">
        <section className="panel">
          <h3>{t('settings.language')}</h3>
          <p className="muted">{t('settings.languageHint')}</p>
          <div className="seg" role="radiogroup" aria-label={t('settings.language')}>
            {LANGS.map((l) => (
              <button
                key={l}
                role="radio"
                aria-checked={l === lang}
                className={l === lang ? 'on' : ''}
                onClick={() => setLang(l)}
              >
                {LANG_NAMES[l]}
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <h3>{t('settings.server')}</h3>
          {health.data && (
            <dl className="kv">
              <div>
                <dt>{t('settings.status')}</dt>
                <dd>
                  <span className="dot" /> {t('settings.online')}
                </dd>
              </div>
              <div>
                <dt>{t('settings.version')}</dt>
                <dd>{health.data.version}</dd>
              </div>
              <div>
                <dt>{t('settings.serverTime')}</dt>
                <dd>{fmtDateTime(health.data.time)}</dd>
              </div>
              <div>
                <dt>{t('settings.epoch')}</dt>
                <dd className="mono">{health.data.epoch.slice(0, 8)}</dd>
              </div>
            </dl>
          )}
        </section>

        <section className="panel">
          <h3>{t('settings.sessions')}</h3>
          <p className="muted">{t('settings.sessionsHint')}</p>
          <ul className="list">
            {devices.data?.items.map((d) => (
              <li key={d.id}>
                <div>
                  <b>{d.kind === 'web' ? t('settings.browser') : d.name}</b>{' '}
                  {d.current && <span className="badge accent">{t('settings.thisSession')}</span>}
                  <div className="muted small">
                    {d.kind === 'device'
                      ? t('settings.device', { platform: d.platform })
                      : t('settings.browser')}{' '}
                    · {t('settings.created', { date: fmtDateTime(d.createdAt) })} ·{' '}
                    {t('settings.lastUsed', { date: fmtDateTime(d.lastSeenAt) })}
                  </div>
                </div>
                <button className="btn sm ghost danger" onClick={() => void revoke(d)}>
                  {t('settings.revoke')}
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
  const { t } = useI18n();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== repeat) return setMsg({ ok: false, text: t('settings.passwordsDiffer') });
    try {
      await api.changePassword({ current, next });
      setMsg({ ok: true, text: t('settings.passwordChanged') });
      setCurrent('');
      setNext('');
      setRepeat('');
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, t) });
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <h3>{t('settings.changePassword')}</h3>
      <div className="fgrid three">
        <label>
          {t('settings.currentPassword')}
          <input
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label>
          {t('settings.newPassword', { min: PASSWORD_MIN_LENGTH })}
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
          {t('settings.repeatPassword')}
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
      <button className="btn">{t('settings.changePassword')}</button>
    </form>
  );
}
