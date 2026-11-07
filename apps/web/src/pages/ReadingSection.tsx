import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  CopyDTO,
  ReadingDTO,
  ReadingFields,
  WorkDetail,
  WorkReadingStatus,
} from '@openlibrary/contracts/client';
import { api, errorText } from '../api';
import { Rating } from '../components/rating';
import { Segmented } from '../components/segmented';
import { useToast } from '../components/snackbar';
import { BusyLabel, Spinner } from '../components/states';
import { Icon } from '../components/ui';
import { fmtDate } from '../lib/format';
import { keys, useInvalidate } from '../lib/queries';
import { currentReading, STATUS_CHOICES, statusChange, type ReadingAction } from '../lib/reading';
import { useI18n } from '../i18n';

export const stars = (r: number) => '★'.repeat(Math.floor(r)) + (r % 1 ? '½' : '');

/**
 * Reading of the work (design §4, BR11–BR13), as the Android app's ReadingCard: the derived status as a
 * segmented choice (choosing one starts, finishes or marks the reading), "Abandon" for the one in
 * progress, the latest reading's dates, stars and notes, and earlier readings.
 *
 * Changes go to the server one after another, in order, and none is dropped: each patch takes the
 * reading's version from the previous answer. The status row waits while anything is being saved, so a
 * second click cannot start a second reading on stale data.
 */
export function ReadingSection({ data, preferredCopy }: { data: WorkDetail; preferredCopy?: CopyDTO }) {
  const { t } = useI18n();
  const toast = useToast();
  const invalidate = useInvalidate();
  const copies = data.editions.flatMap((e) => e.copies);
  const active = copies.filter((c) => c.status === 'active');
  const [copyId, setCopyId] = useState(preferredCopy?.id ?? active[0]?.id ?? copies[0]?.id ?? '');
  const qc = useQueryClient();
  const [inFlight, setInFlight] = useState(0);
  const busy = inFlight > 0;
  // The readings as the last answer left them, so a queued patch sends the version it will meet.
  const readings = useRef(data.readings);
  useEffect(() => {
    readings.current = data.readings;
  }, [data.readings]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const status = data.readingStatus;
  const current = currentReading(data.readings);
  // The latest session is the one the details show and edit (BR12).
  const latest = data.readings.at(-1);
  const earlier = data.readings.slice(0, -1).reverse();
  const codeOf = (id: string) => copies.find((c) => c.id === id)?.code ?? '';

  /** Queues one change after the others; resolves to true when it was saved. */
  function run(call: () => Promise<WorkDetail>): Promise<boolean> {
    setInFlight((n) => n + 1);
    const done = queue.current.then(async () => {
      try {
        // A refetch in flight must not bring back the state from before this change.
        await qc.cancelQueries({ queryKey: keys.work(data.work.id) });
        const w = await call();
        readings.current = w.readings;
        invalidate(w);
        return true;
      } catch (e) {
        toast(errorText(e, t), { kind: 'error' });
        invalidate();
        return false;
      } finally {
        setInFlight((n) => n - 1);
      }
    });
    queue.current = done;
    return done;
  }
  const versionOf = (id: string) => readings.current.find((r) => r.id === id)?.version ?? 0;
  const patch = (id: string, fields: Partial<ReadingFields>) =>
    run(() => api.patchReading(id, { baseVersion: versionOf(id), fields }));
  const reset = (list: ReadingDTO[]) => {
    // One patch per session; run() queues them so each one waits for the previous response.
    for (const r of list) void patch(r.id, { status: 'pending', startedOn: null, finishedOn: null });
  };
  const act = (a: ReadingAction) =>
    a.kind === 'start'
      ? run(() => api.createReading({ copyId: a.copyId, status: a.status }))
      : a.kind === 'reset'
        ? reset(a.readings)
        : patch(a.reading.id, a.fields);

  return (
    <section className="sec">
      <h3>{t('reading.title')}</h3>
      {!current && copies.length > 1 && (
        <label className="inline-field">
          {t('reading.copy')}
          <select value={copyId} onChange={(e) => setCopyId(e.target.value)}>
            {copies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="actions reading-status">
        <Segmented<WorkReadingStatus>
          label={t('reading.statusLabel')}
          mode="action"
          disabled={busy}
          value={status}
          options={STATUS_CHOICES.map((s) => ({
            value: s,
            label: t(`reading.status.${s}`),
            // The current one stays shown; the others only when choosing them does something.
            disabled: s !== status && !statusChange(status, current, s, copyId, data.readings),
          }))}
          onChange={(s) => {
            const a = statusChange(status, current, s, copyId, data.readings);
            if (a) void act(a);
          }}
        />
        {current && (
          <button
            className="btn sm ghost"
            aria-disabled={busy || undefined}
            onClick={() =>
              !busy && void act({ kind: 'edit', reading: current, fields: { status: 'abandoned' } })
            }
          >
            {t('reading.abandon')}
          </button>
        )}
        <span role="status" className="muted small busy-note">
          {busy && (
            <>
              <Spinner small /> {t('common.saving')}
            </>
          )}
        </span>
      </div>

      {latest && (
        <SessionEditor
          key={latest.id}
          session={latest}
          code={codeOf(latest.copyId)}
          onPatch={(fields) => patch(latest.id, fields)}
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
              {r.rating ? (
                <span aria-label={`${t('reading.rating')}: ${t('rating.value', { n: r.rating, max: 5 })}`}>
                  {stars(r.rating)}
                </span>
              ) : null}
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
  onPatch: (fields: Partial<ReadingFields>) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(r.notes);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Leaving the notes editor puts the focus back on "Edit notes", where it started.
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  // "Saved" is said once and fades after a while.
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 4000);
    return () => clearTimeout(timer);
  }, [saved]);
  // Only what changed is sent, so another device's edits to other fields are merged.
  const set = (fields: Partial<ReadingFields>) => void onPatch(fields);

  async function saveNotes() {
    const text = notes.trim();
    if (text === r.notes) return setEditing(false);
    setSaving(true);
    const ok = await onPatch({ notes: text });
    setSaving(false);
    if (ok) {
      setEditing(false);
      setSaved(true);
    }
  }

  return (
    <div className="copy">
      <div className="copy-meta">
        <span>
          {t(`reading.status.${r.status}`)} · <b className="mono">{code}</b>
        </span>
      </div>
      <dl className="kv">
        <div>
          <dt id={`${id}-started`}>{t('reading.started')}</dt>
          <dd>
            <DateField
              labelledBy={`${id}-started`}
              value={r.startedOn}
              onSave={(startedOn) => set({ startedOn })}
            />
          </dd>
        </div>
        <div>
          <dt id={`${id}-finished`}>{t('reading.finished')}</dt>
          <dd>
            <DateField
              labelledBy={`${id}-finished`}
              value={r.finishedOn}
              onSave={(finishedOn) => set({ finishedOn })}
            />
          </dd>
        </div>
      </dl>
      <div className="reading-rating">
        <span className="kv-label" id={`${id}-rating`}>
          {t('reading.rating')}
        </span>
        <Rating label={t('reading.rating')} value={r.rating} onChange={(rating) => set({ rating })} />
      </div>
      <div className="reading-notes">
        <span className="kv-label" id={`${id}-notes`}>
          {t('reading.notes')}
        </span>
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveNotes();
            }}
          >
            <textarea
              rows={3}
              aria-labelledby={`${id}-notes`}
              value={notes}
              autoFocus
              onChange={(e) => setNotes(e.target.value)}
            />
            <div className="actions">
              <button className="btn sm primary" disabled={saving}>
                <BusyLabel busy={saving} busyText={t('common.saving')}>
                  {t('common.save')}
                </BusyLabel>
              </button>
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => {
                  setNotes(r.notes);
                  setEditing(false);
                }}
              >
                {t('common.cancel')}
              </button>
            </div>
          </form>
        ) : (
          <div className="notes-view">
            <p className={r.notes ? 'note' : 'muted small'}>{r.notes || t('reading.noNotes')}</p>
            <button
              ref={editButton}
              type="button"
              className="btn sm"
              onClick={() => {
                setNotes(r.notes);
                setSaved(false);
                setEditing(true);
              }}
            >
              <Icon name="edit" size={15} /> {t('reading.editNotes')}
            </button>
          </div>
        )}
        <span role="status" className="ok small">
          {saved && (
            <>
              <Icon name="check" size={14} /> {t('reading.notesSaved')}
            </>
          )}
        </span>
      </div>
    </div>
  );
}

/** A complete date with a four-digit year (a date field passes through 0002, 0020… while one is typed). */
const isCompleteDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number(v.slice(0, 4)) >= 1000;
const DATE_SAVE_MS = 800;

/**
 * A date that is saved when it is complete: after a short pause, when the field is left, or when the
 * panel closes. Partial years while typing are never sent.
 */
function DateField({
  labelledBy,
  value,
  onSave,
}: {
  labelledBy: string;
  value: string | null;
  onSave: (v: string | null) => void;
}) {
  const [text, setText] = useState(value ?? '');
  /** What the server has (or is about to have). */
  const sent = useRef(value ?? '');
  const timer = useRef<number>(undefined);
  const latest = useRef({ text, onSave });
  latest.current = { text, onSave };
  // A change made elsewhere (another device) replaces the field, unless it is what we sent.
  useEffect(() => {
    if ((value ?? '') === sent.current) return;
    sent.current = value ?? '';
    setText(value ?? '');
  }, [value]);

  const send = (v: string) => {
    clearTimeout(timer.current);
    if (v === sent.current || (v && !isCompleteDate(v))) return;
    sent.current = v;
    latest.current.onSave(v || null);
  };
  // Closing the panel mid-pause still saves a complete date.
  useEffect(() => () => send(latest.current.text), []);

  return (
    <input
      aria-labelledby={labelledBy}
      type="date"
      value={text}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        clearTimeout(timer.current);
        if (!v || isCompleteDate(v)) timer.current = window.setTimeout(() => send(v), DATE_SAVE_MS);
      }}
      onBlur={() => send(text)}
    />
  );
}
