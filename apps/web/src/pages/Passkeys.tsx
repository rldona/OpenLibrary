import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Passkey } from '@openlibrary/contracts/client';
import { api, ApiError, errorText } from '../api';
import { Modal } from '../components/dialog';
import { useSnackbar } from '../components/snackbar';
import { BusyLabel, ErrorState, LoadingState } from '../components/states';
import { fmtDateTime } from '../lib/format';
import { createPasskey, passkeysSupported, wasCancelled } from '../lib/passkeys';
import { useI18n } from '../i18n';

type Prompt =
  | { kind: 'add' }
  | { kind: 'remove'; passkey: Passkey }
  | { kind: 'rename'; passkey: Passkey }
  | { kind: 'codes' };

/** Settings → Passkeys: list, add, rename, remove, and new recovery codes. */
export function PasskeysSection() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { show: toast } = useSnackbar();
  const list = useQuery({ queryKey: ['passkeys'], queryFn: api.passkeys });
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['passkeys'] });
    void qc.invalidateQueries({ queryKey: ['auth-methods'] });
  };
  const items = list.data?.items ?? [];

  async function add(password: string, name: string) {
    const { ceremonyId, options } = await api.passkeyRegisterOptions(password);
    let answer: Record<string, unknown>;
    try {
      answer = await createPasskey(options);
    } catch (e) {
      // The browser's own messages are technical and in its language: ours instead.
      throw new Error(t(wasCancelled(e) ? 'passkeys.cancelled' : 'passkeys.failed'), { cause: e });
    }
    const r = await api.passkeyRegister(ceremonyId, answer, name.trim() || t('passkeys.defaultName'));
    refresh();
    toast(t('passkeys.added'));
    if (r.recoveryCodes) setCodes(r.recoveryCodes);
  }

  return (
    <section className="panel">
      <h3>{t('passkeys.title')}</h3>
      <p className="muted">{t('passkeys.hint')}</p>
      {list.isPending && <LoadingState compact />}
      {list.isError && <ErrorState compact error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && items.length === 0 && <p className="muted small">{t('passkeys.none')}</p>}
      <ul className="list">
        {items.map((p) => (
          <li key={p.id}>
            <div>
              <b>{p.name}</b> {p.backedUp && <span className="badge">{t('passkeys.synced')}</span>}
              <div className="muted small">
                {t('settings.created', { date: fmtDateTime(p.createdAt) })} ·{' '}
                {t('settings.lastUsed', { date: fmtDateTime(p.lastUsedAt) })}
              </div>
            </div>
            <div className="actions tight">
              <button className="btn sm ghost" onClick={() => setPrompt({ kind: 'rename', passkey: p })}>
                {t('passkeys.rename')}
              </button>
              <button
                className="btn sm ghost danger"
                onClick={() => setPrompt({ kind: 'remove', passkey: p })}
              >
                {t('passkeys.remove')}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="actions tight">
        {passkeysSupported() ? (
          <button className="btn" onClick={() => setPrompt({ kind: 'add' })}>
            {t('passkeys.add')}
          </button>
        ) : (
          <p className="muted small">{t('passkeys.unsupported')}</p>
        )}
        {items.length > 0 && (
          <button className="btn ghost" onClick={() => setPrompt({ kind: 'codes' })}>
            {t('passkeys.newCodes')}
          </button>
        )}
      </div>

      {prompt?.kind === 'add' && (
        <PasswordPrompt
          title={t('passkeys.add')}
          text={t('passkeys.addText')}
          withName
          confirmLabel={t('passkeys.add')}
          onSubmit={(password, name) => add(password, name).then(() => setPrompt(null))}
          onClose={() => setPrompt(null)}
        />
      )}
      {prompt?.kind === 'remove' && (
        <PasswordPrompt
          title={t('passkeys.removeTitle', { name: prompt.passkey.name })}
          text={t(items.length === 1 ? 'passkeys.removeLastText' : 'passkeys.removeText')}
          destructive
          confirmLabel={t('passkeys.remove')}
          onSubmit={async (password) => {
            await api.removePasskey(prompt.passkey.id, password);
            setPrompt(null);
            refresh();
            toast(t('passkeys.removed'));
          }}
          onClose={() => setPrompt(null)}
        />
      )}
      {prompt?.kind === 'rename' && (
        <RenamePrompt
          passkey={prompt.passkey}
          onSubmit={async (name) => {
            await api.renamePasskey(prompt.passkey.id, name);
            setPrompt(null);
            refresh();
          }}
          onClose={() => setPrompt(null)}
        />
      )}
      {prompt?.kind === 'codes' && (
        <PasswordPrompt
          title={t('passkeys.newCodes')}
          text={t('passkeys.newCodesText')}
          confirmLabel={t('passkeys.newCodes')}
          onSubmit={async (password) => {
            const r = await api.regenerateCodes(password);
            setPrompt(null);
            setCodes(r.codes);
          }}
          onClose={() => setPrompt(null)}
        />
      )}
      {codes && <CodesDialog codes={codes} onClose={() => setCodes(null)} />}
    </section>
  );
}

/** Asks for the password (and a name when adding) before a sensitive action. */
function PasswordPrompt({
  title,
  text,
  confirmLabel,
  withName = false,
  destructive = false,
  onSubmit,
  onClose,
}: {
  title: string;
  text: string;
  confirmLabel: string;
  withName?: boolean;
  destructive?: boolean;
  onSubmit: (password: string, name: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = `pw-${title.length}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(password, name);
    } catch (err) {
      setError(err instanceof ApiError || !(err instanceof Error) ? errorText(err, t) : err.message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form={formId}
            className={`btn ${destructive ? 'destructive' : 'primary'}`}
            disabled={busy || !password}
          >
            <BusyLabel busy={busy} busyText={t('common.saving')}>
              {confirmLabel}
            </BusyLabel>
          </button>
        </>
      }
    >
      <form id={formId} className="stack" onSubmit={submit}>
        <p>{text}</p>
        {withName && (
          <label>
            {t('passkeys.name')}
            <input
              value={name}
              maxLength={80}
              placeholder={t('passkeys.namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        <label>
          {t('passkeys.password')}
          <input
            type="password"
            autoComplete="current-password"
            required
            data-autofocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <div role="status">{error && <p className="err">{error}</p>}</div>
      </form>
    </Modal>
  );
}

function RenamePrompt({
  passkey,
  onSubmit,
  onClose,
}: {
  passkey: Passkey;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(passkey.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit(name.trim());
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t('passkeys.rename')}
      onClose={onClose}
      dirty={name !== passkey.name}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="passkey-rename" className="btn primary" disabled={busy || !name.trim()}>
            <BusyLabel busy={busy} busyText={t('common.saving')}>
              {t('common.save')}
            </BusyLabel>
          </button>
        </>
      }
    >
      <form id="passkey-rename" onSubmit={submit}>
        <label>
          {t('passkeys.name')}
          <input
            required
            maxLength={80}
            data-autofocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div role="status">{error && <p className="err">{error}</p>}</div>
      </form>
    </Modal>
  );
}

/** Recovery codes, shown once. */
function CodesDialog({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <Modal
      title={t('passkeys.codesTitle')}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn ghost"
            onClick={() =>
              void navigator.clipboard
                ?.writeText(codes.join('\n'))
                .then(() => setCopied(true))
                .catch(() => undefined)
            }
          >
            {copied ? t('passkeys.copied') : t('passkeys.copy')}
          </button>
          <button type="button" className="btn primary" data-autofocus onClick={onClose}>
            {t('passkeys.codesSaved')}
          </button>
        </>
      }
    >
      <p>{t('passkeys.codesText')}</p>
      <ul className="codes mono" aria-label={t('passkeys.codesTitle')}>
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </Modal>
  );
}
