import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DRIVE_BACKUP_INTERVALS,
  type DriveBackupInterval,
  type DriveBackupStatus,
} from '@openlibrary/contracts/client';
import { api, errorText } from '../api';
import { Banner } from '../components/ui';
import { useToast } from '../components/snackbar';
import { BusyLabel, ErrorState, LoadingState } from '../components/states';
import { Segmented } from '../components/segmented';
import { ConfirmDialog } from '../components/dialog';
import { fmtDateTime } from '../lib/format';
import { setParams, useLocation } from '../lib/router';
import { useI18n } from '../i18n';

const KEY = ['drive-backups'] as const;
const OUTCOMES = ['connected', 'denied', 'expired', 'failed'] as const;

/** Backups to the owner's Google Drive: connect, back up now, or every 1/5/10/15 minutes. */
export function DriveBackups() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const { params } = useLocation();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const q = useQuery({
    queryKey: KEY,
    queryFn: api.driveBackups,
    // Quick polling while a backup runs; otherwise now and then, for the automatic ones.
    refetchInterval: (query) => (query.state.data?.running ? 1500 : 30_000),
  });

  // Back from Google's consent screen: /data?drive=connected|denied|expired|failed
  const outcome = params.get('drive');
  useEffect(() => {
    if (!outcome) return;
    if ((OUTCOMES as readonly string[]).includes(outcome)) toast(t(`data.drive.outcome.${outcome}`));
    setParams({ drive: undefined }, { replace: true });
    void qc.invalidateQueries({ queryKey: KEY });
  }, [outcome, qc, t, toast]);

  async function act(fn: () => Promise<DriveBackupStatus>, done?: string) {
    setBusy(true);
    try {
      qc.setQueryData(KEY, await fn());
      if (done) toast(done);
    } catch (e) {
      toast(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    setBusy(true);
    try {
      const { url } = await api.connectDrive();
      window.location.assign(url);
    } catch (e) {
      toast(errorText(e, t));
      setBusy(false);
    }
  }

  const title = <h3>{t('data.drive.title')}</h3>;
  if (!q.data)
    return (
      <section className="panel">
        {title}
        {q.isError ? (
          <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <LoadingState compact />
        )}
      </section>
    );

  const s = q.data;
  return (
    <section className="panel">
      {title}
      <p className="muted">{t('data.drive.hint')}</p>

      {!s.drive.available && <Banner kind="info">{t('data.drive.notAvailable')}</Banner>}

      {s.drive.available && !s.drive.connected && (
        <div className="data-actions">
          <button className="btn primary" disabled={busy} onClick={() => void connect()}>
            <BusyLabel busy={busy} busyText={t('data.drive.connecting')}>
              {t('data.drive.connect')}
            </BusyLabel>
          </button>
        </div>
      )}

      {s.drive.connected && (
        <>
          <dl className="kv">
            <div>
              <dt>{t('data.drive.account')}</dt>
              <dd>{s.drive.account ?? t('data.drive.connected')}</dd>
            </div>
            <div>
              <dt>{t('data.drive.lastBackup')}</dt>
              <dd>{s.lastSuccessAt ? fmtDateTime(s.lastSuccessAt) : t('data.drive.never')}</dd>
            </div>
            <div>
              <dt>{t('data.drive.state')}</dt>
              <dd>
                {s.running
                  ? t('data.drive.running')
                  : s.upToDate
                    ? t('data.drive.upToDate')
                    : t('data.drive.pending')}
              </dd>
            </div>
            {s.nextCheckAt && (
              <div>
                <dt>{t('data.drive.nextCheck')}</dt>
                <dd>{fmtDateTime(s.nextCheckAt)}</dd>
              </div>
            )}
          </dl>
          {s.lastError && <Banner kind="err">{s.lastError}</Banner>}

          <Segmented
            label={t('data.drive.frequency')}
            className="dense"
            options={DRIVE_BACKUP_INTERVALS.map((n) => ({
              value: String(n),
              label: n === 0 ? t('data.drive.manual') : t('data.drive.minutes', { n }),
            }))}
            value={String(s.intervalMinutes)}
            disabled={busy}
            onChange={(v) =>
              void act(() =>
                api.setDriveBackupSettings({ intervalMinutes: Number(v) as DriveBackupInterval }),
              )
            }
          />
          <p className="muted small">
            {s.intervalMinutes > 0 ? t('data.drive.onlyChanges') : t('data.drive.manualHint')}
          </p>

          <div className="data-actions">
            <button
              className="btn primary"
              disabled={busy || s.running}
              onClick={() => void act(api.runDriveBackup)}
            >
              <BusyLabel busy={s.running} busyText={t('data.drive.running')}>
                {t('data.drive.runNow')}
              </BusyLabel>
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => setConfirming(true)}>
              {t('data.drive.disconnect')}
            </button>
          </div>
        </>
      )}

      {confirming && (
        <ConfirmDialog
          title={t('data.drive.disconnectTitle')}
          text={t('data.drive.disconnectText')}
          confirmLabel={t('data.drive.disconnect')}
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() =>
            void act(api.disconnectDrive, t('data.drive.disconnected')).then(() => setConfirming(false))
          }
        />
      )}
    </section>
  );
}
