import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  API_PREFIX,
  BACKUP_STALE_DAYS,
  IMPORT_ENTITIES,
  IMPORT_MAX_BYTES,
  type ImportIssue,
  type ImportReport,
} from '@openlibrary/contracts/client';
import { api, errorText } from '../api';
import { Banner, Icon } from '../components/ui';
import { useToast } from '../components/snackbar';
import { ErrorState, LoadingState } from '../components/states';
import { fmtDateTime } from '../lib/format';
import { useI18n } from '../i18n';

/** UC12–UC14: export, import (dry run first) and the state of the backups. */
export function Data() {
  const { t } = useI18n();
  return (
    <>
      <div className="vh">
        <div>
          <h1 tabIndex={-1}>{t('nav.data')}</h1>
          <p className="sub">{t('data.subtitle')}</p>
        </div>
      </div>
      <div className="stack">
        <Backups />
        <section className="panel">
          <h3>{t('data.export')}</h3>
          <p className="muted">{t('data.exportHint')}</p>
          <div className="data-actions">
            <a className="btn primary" href={`${API_PREFIX}/export/full`} download>
              <Icon name="download" size={16} /> {t('data.exportFull')}
            </a>
            <a className="btn" href={`${API_PREFIX}/export/csv`} download>
              <Icon name="download" size={16} /> {t('data.exportCsv')}
            </a>
          </div>
          <p className="muted small">{t('data.exportCsvHint')}</p>
        </section>
        <Import />
      </div>
    </>
  );
}

function Backups() {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['backups'], queryFn: api.backupStatus });
  if (!q.data)
    return (
      <section className="panel">
        <h3>{t('data.backups')}</h3>
        {q.isError ? (
          <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <LoadingState compact />
        )}
      </section>
    );
  const { lastSuccessAt, stale } = q.data;
  return (
    <section className="panel">
      <h3>{t('data.backups')}</h3>
      {stale ? (
        <Banner kind="warn">
          {lastSuccessAt
            ? t('data.backupStale', { date: fmtDateTime(lastSuccessAt), days: BACKUP_STALE_DAYS })
            : t('data.backupNever')}
        </Banner>
      ) : (
        <Banner kind="ok">{t('data.backupOk', { date: fmtDateTime(lastSuccessAt) })}</Banner>
      )}
      <p className="muted small">{t('data.backupHint')}</p>
    </section>
  );
}

type Step =
  | { kind: 'idle' }
  | { kind: 'busy'; file: File; dryRun: boolean }
  | { kind: 'checked'; file: File; report: ImportReport }
  | { kind: 'done'; report: ImportReport }
  | { kind: 'error'; message: string };

function Import() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [step, setStep] = useState<Step>({ kind: 'idle' });

  async function run(file: File, dryRun: boolean) {
    if (file.size > IMPORT_MAX_BYTES) {
      return setStep({ kind: 'error', message: t('data.tooLarge', { mb: IMPORT_MAX_BYTES / 1024 / 1024 }) });
    }
    setStep({ kind: 'busy', file, dryRun });
    try {
      const report = await api.importFile(file, dryRun);
      if (dryRun) return setStep({ kind: 'checked', file, report });
      setStep({ kind: 'done', report });
      void qc.invalidateQueries();
      toast(t('data.imported', { n: created(report) }));
    } catch (e) {
      setStep({ kind: 'error', message: errorText(e, t) });
    }
  }

  return (
    <section className="panel">
      <h3>{t('data.import')}</h3>
      <p className="muted">{t('data.importHint')}</p>
      <div className="data-actions">
        <label className="btn file">
          <Icon name="upload" size={16} /> {t('data.chooseFile')}
          <input
            type="file"
            accept=".zip,.json,.csv,application/zip,application/json,text/csv"
            disabled={step.kind === 'busy'}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void run(f, true);
            }}
          />
        </label>
      </div>
      {step.kind === 'busy' && (
        <LoadingState
          compact
          delay={0}
          label={t(step.dryRun ? 'data.checking' : 'data.importing', { name: step.file.name })}
        />
      )}
      {step.kind === 'error' && <Banner kind="err">{step.message}</Banner>}
      {step.kind === 'checked' && (
        <>
          <Banner kind={created(step.report) ? 'info' : 'warn'}>
            {created(step.report)
              ? t('data.dryRunReady', { name: step.file.name })
              : t('data.nothingToImport', { name: step.file.name })}
          </Banner>
          <ReportView report={step.report} />
          <div className="data-actions">
            <button
              className="btn primary"
              disabled={!created(step.report)}
              onClick={() => void run(step.file, false)}
            >
              {t('data.confirmImport', { n: created(step.report) })}
            </button>
            <button className="btn ghost" onClick={() => setStep({ kind: 'idle' })}>
              {t('common.cancel')}
            </button>
          </div>
        </>
      )}
      {step.kind === 'done' && (
        <>
          <Banner kind="ok">{t('data.importDone', { n: created(step.report) })}</Banner>
          <ReportView report={step.report} />
        </>
      )}
    </section>
  );
}

const created = (r: ImportReport) => Object.values(r.counts).reduce((n, c) => n + c.created, 0);

function ReportView({ report }: { report: ImportReport }) {
  const { t } = useI18n();
  const rows = IMPORT_ENTITIES.filter((e) => {
    const c = report.counts[e];
    return c.created + c.duplicates + c.invalid > 0;
  });
  return (
    <>
      {rows.length > 0 && (
        <table className="report">
          <thead>
            <tr>
              <th />
              <th>{t('data.created')}</th>
              <th>{t('data.duplicates')}</th>
              <th>{t('data.invalid')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e}>
                <th scope="row">{t(`data.entity.${e}`)}</th>
                <td>{report.counts[e].created}</td>
                <td>{report.counts[e].duplicates}</td>
                <td className={report.counts[e].invalid ? 'err' : undefined}>{report.counts[e].invalid}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {report.issues.length > 0 && (
        <details className="issues" open={report.issues.some((i) => i.kind === 'invalid')}>
          <summary>
            {t('data.issues', { n: report.issuesTotal })}
            {report.issuesTotal > report.issues.length &&
              ` · ${t('data.issuesShown', { n: report.issues.length })}`}
          </summary>
          <ul className="list">
            {report.issues.map((i, k) => (
              <IssueRow key={k} issue={i} csv={report.source === 'csv'} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function IssueRow({ issue, csv }: { issue: ImportIssue; csv: boolean }) {
  const { t } = useI18n();
  const badge = issue.kind === 'invalid' ? 'warn' : issue.kind === 'warning' ? 'accent' : '';
  return (
    <li>
      <div>
        <span className={`badge ${badge}`}>{t(`data.kind.${issue.kind}`)}</span>{' '}
        <b>{issue.label ?? issue.id ?? '—'}</b>
        <div className="muted small">
          {csv
            ? t('data.line', { n: issue.row })
            : t('data.record', { entity: t(`data.entity.${issue.entity}`), n: issue.row })}{' '}
          · {issue.message}
        </div>
      </div>
    </li>
  );
}
