import type { CountBy, StatsDTO } from '@openlibrary/contracts';
import { useQuery } from '@tanstack/react-query';
import { api, errorText } from '../api';
import { Banner } from '../components/ui';
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
          <h1>{t('nav.stats')}</h1>
          <p className="sub">{t('stats.subtitle')}</p>
        </div>
      </div>
      {q.isError && <Banner kind="err">{errorText(q.error, t)}</Banner>}
      {s && <Figures s={s} />}
    </>
  );
}

function Figures({ s }: { s: StatsDTO }) {
  const { t } = useI18n();
  const c = s.collection;
  const r = s.reading;
  return (
    <div className="stats">
      <section className="panel">
        <h3>{t('stats.collection')}</h3>
        <div className="tiles">
          <Tile n={c.works} label={t('stats.works')} />
          <Tile n={c.editions} label={t('stats.editions')} />
          <Tile n={c.copies} label={t('stats.copies')} />
          <Tile n={c.retiredCopies} label={t('stats.retired')} />
        </div>
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

      <section className="panel">
        <h3>{t('stats.reading')}</h3>
        <div className="tiles">
          <Tile n={r.read} label={t('reading.status.read')} />
          <Tile n={r.reading} label={t('reading.status.reading')} />
          <Tile n={r.pending} label={t('reading.status.pending')} />
          <Tile n={r.averageRating ?? '—'} label={t('stats.averageRating')} />
        </div>
        <p className="muted small">
          {t('stats.sessions', { finished: r.finishedSessions, abandoned: r.abandonedSessions })}
        </p>
        <Bars
          title={t('stats.readByYear')}
          rows={r.byYear.map((y) => ({
            label: String(y.year),
            value: y.works,
            note: t('stats.pages', { n: y.pages }),
          }))}
        />
      </section>

      <section className="panel">
        <Bars
          title={t('stats.acquiredByYear')}
          rows={s.acquiredByYear.map((y) => ({ label: String(y.year), value: y.copies }))}
        />
      </section>
      <section className="panel">
        <Bars title={t('stats.authors')} rows={counts(s.authors)} />
      </section>
      <section className="panel">
        <Bars title={t('stats.subjects')} rows={counts(s.subjects)} />
      </section>
      <section className="panel">
        <Bars
          title={t('stats.languages')}
          rows={counts(s.languages, (k) => (k ? langName(k) : t('stats.unknownLanguage')))}
        />
      </section>
    </div>
  );
}

const counts = (list: CountBy[], label = (k: string) => k) =>
  list.map((x) => ({ label: label(x.key), value: x.count }));

function Tile({ n, label }: { n: number | string; label: string }) {
  return (
    <div className="tile">
      <b>{n}</b>
      <span>{label}</span>
    </div>
  );
}

/** Horizontal bars relative to the largest value: no chart library needed for a few rows. */
function Bars({ title, rows }: { title: string; rows: { label: string; value: number; note?: string }[] }) {
  const { t } = useI18n();
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      <h3>{title}</h3>
      {!rows.length && <p className="muted small">{t('stats.none')}</p>}
      {rows.map((r) => (
        <div key={r.label} className="bar-row">
          <span className="bar-label">{r.label}</span>
          <span className="bar" style={{ width: `${(r.value / max) * 100}%` }} />
          <b>{r.value}</b>
          {r.note && <span className="muted small">{r.note}</span>}
        </div>
      ))}
    </div>
  );
}
