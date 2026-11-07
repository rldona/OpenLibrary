import type { CountBy, StatsDTO } from '@openlibrary/contracts/client';
import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { ErrorState, LoadingState } from '../components/states';
import { fmtPrice, langName } from '../lib/format';
import { keys } from '../lib/queries';
import { useI18n } from '../i18n';

/** UC11: collection, reading and acquisitions, counting works and copies separately. */
export function Stats() {
  const { t } = useI18n();
  const q = useQuery({ queryKey: keys.stats, queryFn: api.stats });
  const s = q.data;
  return (
    <>
      <div className="vh">
        <div>
          <h1 tabIndex={-1}>{t('nav.stats')}</h1>
          <p className="sub">{t('stats.subtitle')}</p>
        </div>
      </div>
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {s && <Figures s={s} />}
    </>
  );
}

function Figures({ s }: { s: StatsDTO }) {
  const { t } = useI18n();
  const c = s.collection;
  const r = s.reading;
  // The page is the h1; each card is an h2 and a chart inside a card an h3.
  return (
    <div className="stats">
      <section className="panel" aria-labelledby="stats-collection">
        <h2 id="stats-collection">{t('stats.collection')}</h2>
        <dl className="tiles">
          <Tile n={c.works} label={t('stats.works')} />
          <Tile n={c.editions} label={t('stats.editions')} />
          <Tile n={c.copies} label={t('stats.copies')} />
          <Tile n={c.retiredCopies} label={t('stats.retired')} />
        </dl>
        <p className="muted small">
          {t('stats.withoutLocation', { n: c.copiesWithoutLocation })} ·{' '}
          {t('stats.provisional', { n: c.provisionalEditions })} · {t('stats.locations', { n: c.locations })}{' '}
          · {t('stats.wishlistOpen', { n: s.wishlistOpen })}
        </p>
        {c.value.length > 0 && (
          <p>
            {t('stats.value')}: <b>{c.value.map((v) => fmtPrice(v.cents, v.currency)).join(' + ')}</b>
          </p>
        )}
      </section>

      <section className="panel" aria-labelledby="stats-reading">
        <h2 id="stats-reading">{t('stats.reading')}</h2>
        <dl className="tiles">
          <Tile n={r.read} label={t('reading.status.read')} />
          <Tile n={r.reading} label={t('reading.status.reading')} />
          <Tile n={r.pending} label={t('reading.status.pending')} />
          <Tile n={r.averageRating ?? '—'} label={t('stats.averageRating')} />
        </dl>
        <p className="muted small">
          {t('stats.sessions', { finished: r.finishedSessions, abandoned: r.abandonedSessions })}
        </p>
        <Bars
          level={3}
          title={t('stats.readByYear')}
          rows={r.byYear.map((y) => ({
            label: String(y.year),
            value: y.works,
            note: t('stats.pages', { n: y.pages }),
          }))}
        />
      </section>

      <Bars
        card
        title={t('stats.acquiredByYear')}
        rows={s.acquiredByYear.map((y) => ({ label: String(y.year), value: y.copies }))}
      />
      <Bars card title={t('stats.authors')} rows={counts(s.authors)} />
      <Bars card title={t('stats.subjects')} rows={counts(s.subjects)} />
      <Bars
        card
        title={t('stats.languages')}
        rows={counts(s.languages, (k) => (k ? langName(k) : t('stats.unknownLanguage')))}
      />
    </div>
  );
}

const counts = (list: CountBy[], label = (k: string) => k) =>
  list.map((x) => ({ label: label(x.key), value: x.count }));

/** A figure as a Material 3 filled card: the number large, its name below (read name first). */
function Tile({ n, label }: { n: number | string; label: string }) {
  return (
    <div className="tile">
      <dt>{label}</dt>
      <dd>{n}</dd>
    </div>
  );
}

/**
 * Horizontal bars relative to the largest value: no chart library needed for a few rows. Each row is a
 * list item with its name and its value as text; the bar itself is decoration.
 */
function Bars({
  title,
  rows,
  level = 2,
  card = false,
}: {
  title: string;
  rows: { label: string; value: number; note?: string }[];
  level?: 2 | 3;
  /** A card of its own (a section) rather than part of another one. */
  card?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const max = Math.max(1, ...rows.map((r) => r.value));
  const Heading = card || level === 2 ? 'h2' : 'h3';
  const body = (
    <>
      <Heading id={id} className={Heading === 'h3' ? 'sub-heading' : undefined}>
        {title}
      </Heading>
      {!rows.length ? (
        <p className="muted small">{t('stats.none')}</p>
      ) : (
        <ul className="bars" aria-labelledby={id}>
          {rows.map((r) => (
            <li key={r.label} className="bar-row">
              <span className="bar-label">{r.label}</span>
              <span className="bar" aria-hidden style={{ width: `${(r.value / max) * 100}%` }} />
              <b>{r.value}</b>
              {r.note && <span className="muted small">{r.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
  return card ? (
    <section className="panel" aria-labelledby={id}>
      {body}
    </section>
  ) : (
    <div>{body}</div>
  );
}
