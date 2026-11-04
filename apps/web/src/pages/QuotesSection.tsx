import { useState, type FormEvent } from 'react';
import type { QuoteDTO, WorkDetail } from '@openlibrary/contracts';
import { api, errorText } from '../api';
import { useToast } from '../components/ui';
import { useInvalidate } from '../lib/queries';
import { useI18n } from '../i18n';

/** Quotes kept from the work: add, edit and delete (it is your own note, so deleting is fine). */
export function QuotesSection({ data }: { data: WorkDetail }) {
  const { t } = useI18n();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [editing, setEditing] = useState<QuoteDTO | 'new' | null>(null);
  const copies = data.editions.flatMap((e) => e.copies);

  async function run(call: () => Promise<WorkDetail>) {
    try {
      invalidate(await call());
      setEditing(null);
    } catch (e) {
      toast(errorText(e, t));
      invalidate();
    }
  }

  return (
    <section className="sec">
      <h3>
        {t('quotes.title')} {data.quotes.length > 0 && <span className="badge">{data.quotes.length}</span>}
      </h3>
      {data.quotes.map((q) =>
        editing !== 'new' && editing?.id === q.id ? (
          <QuoteEditor
            key={q.id}
            quote={q}
            copies={copies}
            onCancel={() => setEditing(null)}
            onSave={(f) => run(() => api.patchQuote(q.id, { baseVersion: q.version, fields: f }))}
          />
        ) : (
          <blockquote key={q.id} className="quote">
            <p>{q.text}</p>
            <footer className="muted small">
              {[
                q.page && t('quotes.pageN', { n: q.page }),
                q.copyId && copies.find((c) => c.id === q.copyId)?.code,
              ]
                .filter(Boolean)
                .join(' · ')}
              {q.note && <span> — {q.note}</span>}
              <span className="actions tight">
                <button className="btn sm ghost" onClick={() => setEditing(q)}>
                  {t('common.edit')}
                </button>
                <button
                  className="btn sm ghost danger"
                  onClick={() => confirm(t('quotes.deleteConfirm')) && void run(() => api.deleteQuote(q.id))}
                >
                  {t('common.delete')}
                </button>
              </span>
            </footer>
          </blockquote>
        ),
      )}
      {editing === 'new' ? (
        <QuoteEditor
          copies={copies}
          onCancel={() => setEditing(null)}
          onSave={(f) => run(() => api.createQuote({ workId: data.work.id, text: '', ...f }))}
        />
      ) : (
        <button className="btn sm" onClick={() => setEditing('new')}>
          {t('quotes.add')}
        </button>
      )}
    </section>
  );
}

type QuoteDraft = { text: string; page: number | null; note: string; copyId: string | null };

function QuoteEditor({
  quote,
  copies,
  onSave,
  onCancel,
}: {
  quote?: QuoteDTO;
  copies: { id: string; code: string }[];
  onSave: (fields: Partial<QuoteDraft>) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(quote?.text ?? '');
  const [page, setPage] = useState(quote?.page ? String(quote.page) : '');
  const [note, setNote] = useState(quote?.note ?? '');
  const [copyId, setCopyId] = useState(quote?.copyId ?? '');

  function submit(e: FormEvent) {
    e.preventDefault();
    const draft: QuoteDraft = {
      text: text.trim(),
      page: page ? Number(page) : null,
      note: note.trim(),
      copyId: copyId || null,
    };
    // Editing sends only what changed, so another device's edits are merged.
    const fields = quote
      ? Object.fromEntries(Object.entries(draft).filter(([k, v]) => v !== quote[k as keyof QuoteDraft]))
      : draft;
    void onSave(fields);
  }

  return (
    <form className="copy" onSubmit={submit}>
      <label>
        {t('quotes.text')}
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </label>
      <div className="fgrid">
        <label>
          {t('quotes.page')}
          <input
            inputMode="numeric"
            value={page}
            onChange={(e) => setPage(e.target.value.replace(/\D/g, '').slice(0, 5))}
          />
        </label>
        {copies.length > 1 && (
          <label>
            {t('reading.copy')}
            <select value={copyId} onChange={(e) => setCopyId(e.target.value)}>
              <option value="">—</option>
              {copies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="span2">
          {t('quotes.note')}
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <div className="actions">
        <button className="btn sm primary" disabled={!text.trim()}>
          {t('common.save')}
        </button>
        <button type="button" className="btn sm ghost" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
