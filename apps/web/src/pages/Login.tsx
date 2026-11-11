import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, errorText } from '../api';
import { Icon, Logo } from '../components/ui';
import { LanguageSwitch, useI18n } from '../i18n';
import { getPasskey, passkeysSupported, wasCancelled } from '../lib/passkeys';

/**
 * Sign-in. With passkeys registered, "Sign in with a passkey" comes first and the password form
 * (bootstrap and recovery) also asks for a recovery code. Without passkeys it is the password form
 * as always.
 */
export function Login({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const methods = useQuery({ queryKey: ['auth-methods'], queryFn: api.authMethods, retry: false });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  // Also turned on by a `passkey-required` answer, in case passkeys were added since the page loaded.
  const [needsCode, setNeedsCode] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'password' | 'passkey' | null>(null);

  const hasPasskeys = !!methods.data?.passkeys || needsCode;
  const offerPasskey = hasPasskeys && passkeysSupported();
  const showPassword = !offerPasskey || usePassword;
  const askCode = hasPasskeys;

  async function withPasskey() {
    setBusy('passkey');
    setError(null);
    try {
      const { ceremonyId, options } = await api.passkeyLoginOptions();
      await api.passkeyLogin(ceremonyId, await getPasskey(options));
      onDone();
    } catch (err) {
      setError(wasCancelled(err) ? t('passkeys.cancelled') : errorText(err, t));
    } finally {
      setBusy(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy('password');
    setError(null);
    try {
      await api.login({ password, ...(askCode && code ? { recoveryCode: code } : {}) });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.problem.code === 'passkey-required') {
        setNeedsCode(true);
        setError(t('login.recoveryHint'));
      } else {
        setError(errorText(err, t));
        setPassword('');
      }
    } finally {
      setBusy(null);
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
        <p className="muted">{offerPasskey ? t('login.subtitlePasskey') : t('login.subtitle')}</p>
        {offerPasskey && (
          <button
            type="button"
            className="btn primary block"
            disabled={!!busy}
            onClick={() => void withPasskey()}
          >
            <Icon name="key" /> {busy === 'passkey' ? t('login.signingIn') : t('login.withPasskey')}
          </button>
        )}
        {offerPasskey && !usePassword && (
          <button type="button" className="btn ghost block" onClick={() => setUsePassword(true)}>
            {t('login.usePassword')}
          </button>
        )}
        {showPassword && (
          <>
            {askCode && <p className="muted small">{t('login.recoveryHint')}</p>}
            <label>
              {t('login.password')}
              <input
                type="password"
                autoComplete="current-password"
                autoFocus={!offerPasskey}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {askCode && (
              <label>
                {t('login.recoveryCode')}
                <input
                  autoComplete="one-time-code"
                  spellCheck={false}
                  autoCapitalize="none"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
            )}
          </>
        )}
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
        {showPassword && (
          <button
            className={`btn block ${offerPasskey ? '' : 'primary'}`}
            disabled={!!busy || !password || (askCode && !code)}
          >
            {busy === 'password' ? t('login.signingIn') : t('login.signIn')}
          </button>
        )}
      </form>
    </div>
  );
}
