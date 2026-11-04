import { useEffect, useState } from 'react';
import type { CopyDTO, ReadingDTO, ReadingFields, WorkDetail } from '@openlibrary/contracts';
import { api, errorText } from '../api';
import { useToast } from '../components/ui';
import { fmtDate } from '../lib/format';
import { useInvalidate } from '../lib/queries';
import { useI18n } from '../i18n';

const RATINGS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
export const stars = (r: number) => '★'.repeat(Math.floor(r)) + (r % 1 ? '½' : '');

/**
 * Reading of the work (design §4, BR11–BR13): the derived status, actions on the current session
 * (start, finish, abandon, re-read) and its rating, dates and notes; earlier sessions below.
 */
export function ReadingSection({ data, preferredCopy }: { data: WorkDetail; preferredCopy?: CopyDTO }) {
  const { t } = useI18n();
  const toast = useToast();
  const invalidate = useInvalidate();
  const copies = data.editions.flatMap((e) => e.copies);
  const active = copies.filter((c) => c.status === 'active');
  const [copyId, setCopyId] = useState(preferredCopy?.id ?? active[0]?.id ?? copies[0]?.id ?? '');
  // The latest session is the one the details show and edit (BR12).
  const latest = data.readings.at(-1);
  const earlier = data.readings.slice(0, -1).reverse();
  const codeOf = (id: string) => copies.find((c) => c.id === id)?.code ?? '';

  async function run(call: () => Promise<WorkDetail>) {
    try {
      invalidate(await call());
    } catch (e) {
      toast(errorText(e, t));
      invalidate();
    }
  }
  const start = (status: 'reading' | 'read') => run(() => api.createReading({ copyId, status }));
  const patch = (r: ReadingDTO, fields: Partial<ReadingFields>) =>
    run(() => api.patchReading(r.id, { baseVersion: r.version, fields }));

  const reading = latest?.status === 'reading' ? latest : undefined;
  return (
    <section className="sec">
      <h3>
        {t('reading.title')}{' '}
        <span className={`badge ${data.readingStatus === 'reading' ? 'accent' : ''}`}>
          {t(`reading.status.${data.readingStatus}`)}
        </span>
      </h3>

      <div className="actions">
        {reading ? (
          <>
            <button className="btn sm primary" onClick={() => void patch(reading, { status: 'read' })}>
              {t('reading.finish')}
            </button>
            <button className="btn sm ghost" onClick={() => void patch(reading, { status: 'abandoned' })}>
              {t('reading.abandon')}
            </button>
          </>
        ) : (
          <>
            {copies.length > 1 && (
              <select
                aria-label={t('reading.copy')}
                value={copyId}
                onChange={(e) => setCopyId(e.target.value)}
              >
                {copies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code}
                  </option>
                ))}
              </select>
            )}
            <button className="btn sm primary" disabled={!copyId} onClick={() => void start('reading')}>
              {t(data.readingStatus === 'read' ? 'reading.reread' : 'reading.start')}
            </button>
            <button className="btn sm" disabled={!copyId} onClick={() => void start('read')}>
              {t('reading.markRead')}
            </button>
          </>
        )}
      </div>

      {latest && (
        <SessionEditor
          key={`${latest.id}:${latest.version}`}
          session={latest}
          code={codeOf(latest.copyId)}
          onPatch={patch}
        />
      )}

      {earlier.length > 0 && (
        <details className="retired">
          <summary>{t('reading.history', { n: earlier.length })}</summary>
          {earlier.map((r) => (
            <div key={r.id} className="row-sm">
              <span>{t(`reading.status.${r.status}`)}</span>
              <span className="muted">
                {fmtDate(r.startedOn)} → {fmtDate(r.finishedOn)} · {codeOf(r.copyId)}
              </span>
              <span>{r.rating ? stars(r.rating) : ''}</span>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}

function SessionEditor({
  session: r,
  code,
  onPatch,
}: {
  session: ReadingDTO;
  code: string;
  onPatch: (r: ReadingDTO, fields: Partial<ReadingFields>) => Promise<void>;
}) {
  const { t } = useI18n();
  const [notes, setNotes] = useState(r.notes);
  useEffect(() => setNotes(r.notes), [r.notes]);
  // Only what changed is sent, so another device's edits to other fields are merged.
  const set = (fields: Partial<ReadingFields>) => void onPatch(r, fields);
  return (
    <div className="copy">
      <div className="copy-meta">
        <span>
          {t(`reading.status.${r.status}`)} · <b className="mono">{code}</b>
        </span>
      </div>
      <dl className="kv">
        <div>
          <dt>{t('reading.started')}</dt>
          <dd>
            <input
              type="date"
              value={r.startedOn ?? ''}
              onChange={(e) => set({ startedOn: e.target.value || null })}
            />
          </dd>
        </div>
        <div>
          <dt>{t('reading.finished')}</dt>
          <dd>
            <input
              type="date"
              value={r.finishedOn ?? ''}
              onChange={(e) => set({ finishedOn: e.target.value || null })}
            />
          </dd>
        </div>
        <div>
          <dt>{t('reading.rating')}</dt>
          <dd>
            <select
              value={r.rating ?? ''}
              onChange={(e) => set({ rating: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">{t('reading.noRating')}</option>
              {RATINGS.map((n) => (
                <option key={n} value={n}>
                  {stars(n)} {n}
                </option>
              ))}
            </select>
          </dd>
        </div>
      </dl>
      <label>
        {t('reading.notes')}
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes.trim() !== r.notes && set({ notes: notes.trim() })}
        />
      </label>
    </div>
  );
}
