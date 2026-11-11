import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LANGS, PASSWORD_MIN_LENGTH, type Device } from '@openlibrary/contracts/client';
import { api, errorText } from '../api';
import { SIGN_OUT_FLUSH_MS, useSnackbar } from '../components/snackbar';
import { ConfirmDialog } from '../components/dialog';
import { Icon } from '../components/ui';
import { navigate } from '../lib/router';
import { BusyLabel, ErrorState, LoadingState } from '../components/states';
import { fmtDateTime } from '../lib/format';
import { LANG_NAMES, useI18n } from '../i18n';
import { PasskeysSection } from './Passkeys';

export function Settings({
  onLogout,
  onSignOut,
  compact = false,
}: {
  /** The session is gone (revoked here): back to the sign-in screen. */
  onLogout: () => void;
  /** Signs out of this browser. */
  onSignOut: () => void;
  /** Narrow screens: the bottom bar has no room for "Import and export" and "Sign out", so they are here. */
  compact?: boolean;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { show: toast, flush } = useSnackbar();
  const health = useQuery({ queryKey: ['health'], queryFn: api.health });
  const devices = useQuery({ queryKey: ['devices'], queryFn: api.devices });
  const [revoking, setRevoking] = useState<Device | null>(null);
  const nameOf = (d: Device) => (d.kind === 'web' ? t('settings.browser') : d.name);

  /** Irreversible (that device has to sign in again): asked for with a destructive dialog. */
  async function revoke(d: Device) {
    setRevoking(null);
    const name = nameOf(d);
    try {
      // Revoking this very session signs it out: pending deletions go first, while it is still valid.
      if (d.current) await flush({ timeoutMs: SIGN_OUT_FLUSH_MS });
      await api.revoke(d.id);
      if (d.current) return onLogout();
      void qc.invalidateQueries({ queryKey: ['devices'] });
      toast(t('settings.revoked', { name }));
    } catch (e) {
      toast(errorText(e, t), { kind: 'error' });
    }
  }

  return (
    <>
      <div className="vh">
        <div>
          <h1 tabIndex={-1}>{t('nav.settings')}</h1>
          <p className="sub">{t('settings.subtitle')}</p>
        </div>
      </div>
      <div className="stack">
        <section className="panel">
          <h3>{t('settings.language')}</h3>
          <p className="muted">{t('settings.languageHint')}</p>
          <LanguageRadios />
        </section>

        <section className="panel">
          <h3>{t('settings.server')}</h3>
          {health.isPending && <LoadingState compact />}
          {health.isError && (
            <ErrorState compact error={health.error} onRetry={() => void health.refetch()} />
          )}
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
          {devices.isPending && <LoadingState compact />}
          {devices.isError && (
            <ErrorState compact error={devices.error} onRetry={() => void devices.refetch()} />
          )}
          <ul className="list">
            {devices.data?.items.map((d) => (
              <li key={d.id}>
                <div>
                  <b>{nameOf(d)}</b>{' '}
                  {d.current && <span className="badge accent">{t('settings.thisSession')}</span>}
                  <div className="muted small">
                    {d.kind === 'device'
                      ? t('settings.device', { platform: d.platform })
                      : t('settings.browser')}{' '}
                    · {t('settings.created', { date: fmtDateTime(d.createdAt) })} ·{' '}
                    {t('settings.lastUsed', { date: fmtDateTime(d.lastSeenAt) })}
                  </div>
                </div>
                <button className="btn sm ghost danger" onClick={() => setRevoking(d)}>
                  {t('settings.revoke')}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <PasskeysSection />

        <ChangePassword />

        {compact && (
          <section className="panel">
            <h3>{t('settings.more')}</h3>
            <p className="muted">{t('settings.moreHint')}</p>
            <div className="actions tight">
              <a
                className="btn"
                href="/data"
                onClick={(e) => {
                  e.preventDefault();
                  navigate('/data');
                }}
              >
                <Icon name="download" size={16} /> {t('nav.data')}
              </a>
              <button className="btn" onClick={onSignOut}>
                <Icon name="logout" size={16} /> {t('nav.logout')}
              </button>
            </div>
          </section>
        )}
      </div>
      {revoking && (
        <ConfirmDialog
          title={t('settings.revokeTitle', { name: nameOf(revoking) })}
          text={t('settings.revokeText')}
          confirmLabel={t('settings.revoke')}
          onCancel={() => setRevoking(null)}
          onConfirm={() => void revoke(revoking)}
        />
      )}
    </>
  );
}

/** The interface language as a radio group: one tab stop, the arrow keys move and select. */
function LanguageRadios() {
  const { t, lang, setLang } = useI18n();
  const group = useRef<HTMLDivElement>(null);
  function onKeyDown(e: KeyboardEvent) {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const next = LANGS[(LANGS.indexOf(lang) + step + LANGS.length) % LANGS.length]!;
    setLang(next);
    group.current?.querySelector<HTMLElement>(`[data-lang="${next}"]`)?.focus();
  }
  return (
    <div
      className="seg"
      role="radiogroup"
      aria-label={t('settings.language')}
      ref={group}
      onKeyDown={onKeyDown}
    >
      {LANGS.map((l) => (
        <button
          key={l}
          data-lang={l}
          role="radio"
          aria-checked={l === lang}
          tabIndex={l === lang ? 0 : -1}
          className={l === lang ? 'on' : ''}
          onClick={() => setLang(l)}
        >
          {LANG_NAMES[l]}
        </button>
      ))}
    </div>
  );
}

function ChangePassword() {
  const { t } = useI18n();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== repeat) return setMsg({ ok: false, text: t('settings.passwordsDiffer') });
    setBusy(true);
    try {
      await api.changePassword({ current, next });
      setMsg({ ok: true, text: t('settings.passwordChanged') });
      setCurrent('');
      setNext('');
      setRepeat('');
    } catch (err) {
      setMsg({ ok: false, text: errorText(err, t) });
    } finally {
      setBusy(false);
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
      {/* Always in the page, so the result is announced when it appears. */}
      <div role="status">{msg && <p className={msg.ok ? 'ok' : 'err'}>{msg.text}</p>}</div>
      <button className="btn" disabled={busy}>
        <BusyLabel busy={busy} busyText={t('common.saving')}>
          {t('settings.changePassword')}
        </BusyLabel>
      </button>
    </form>
  );
}
