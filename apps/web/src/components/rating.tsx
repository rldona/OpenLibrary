/**
 * A star rating (as the Android app's RatingBar): a radio group of five stars. Choosing a star sets that
 * many; choosing the same one again removes the rating. The arrows move and choose, Home and End go to one
 * and five, Delete or Backspace remove it. Half stars set elsewhere (the server accepts them) are shown.
 */
import { useId, useRef, type KeyboardEvent } from 'react';
import { MAX_RATING, starFill, toggledRating } from '../lib/rating';
import { LOCALES, useI18n } from '../i18n';
import { Icon } from './ui';

const STAR =
  'M12 2.8l2.83 5.74 6.34.92-4.59 4.47 1.08 6.31L12 17.27l-5.66 2.97 1.08-6.31L2.83 9.46l6.34-.92z';

function Star({ fill }: { fill: 'full' | 'half' | 'empty' }) {
  const id = useId();
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
      <defs>
        <clipPath id={id}>
          <rect x="0" y="0" width="12" height="24" />
        </clipPath>
      </defs>
      <path d={STAR} className="star-empty" />
      {fill !== 'empty' && (
        <path d={STAR} className="star-full" clipPath={fill === 'half' ? `url(#${id})` : undefined} />
      )}
    </svg>
  );
}

export function Rating({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  /** The group's accessible name. */
  label: string;
  disabled?: boolean;
}) {
  const { t, lang } = useI18n();
  const group = useRef<HTMLDivElement>(null);
  const stars = Array.from({ length: MAX_RATING }, (_, i) => i + 1);
  // The tab stop: the chosen star, the one a half rating rounds up to, or the first.
  const stop = value ? Math.min(MAX_RATING, Math.ceil(value)) : 1;

  const choose = (n: number | null) => {
    if (disabled || n === value) return;
    onChange(n);
  };
  const focusStar = (n: number) => group.current?.querySelector<HTMLElement>(`[data-star="${n}"]`)?.focus();

  function onKeyDown(e: KeyboardEvent) {
    const cur = value ?? 0;
    let next: number | null | undefined;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(MAX_RATING, Math.floor(cur) + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(1, Math.ceil(cur) - 1);
    else if (e.key === 'Home') next = 1;
    else if (e.key === 'End') next = MAX_RATING;
    else if (e.key === 'Delete' || e.key === 'Backspace') next = null;
    if (next === undefined) return;
    e.preventDefault();
    // Waiting: nothing changes, so the focus stays where it is.
    if (disabled) return;
    choose(next);
    focusStar(next ?? 1);
  }

  return (
    <div className="rating-row">
      <div
        ref={group}
        className="rating"
        role="radiogroup"
        aria-label={label}
        aria-busy={disabled || undefined}
        onKeyDown={onKeyDown}
      >
        {stars.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            data-star={n}
            aria-checked={value === n}
            aria-label={t('rating.value', { n, max: MAX_RATING })}
            aria-disabled={disabled || undefined}
            tabIndex={n === stop ? 0 : -1}
            title={value === n ? t('rating.clear') : t('rating.set', { n, max: MAX_RATING })}
            onClick={() => !disabled && onChange(toggledRating(value, n))}
          >
            <Star fill={starFill(value, n)} />
          </button>
        ))}
      </div>
      {value !== null && (
        <>
          <span className="muted small rating-value">
            {new Intl.NumberFormat(LOCALES[lang]).format(value)}
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('rating.clear')}
            aria-disabled={disabled || undefined}
            onClick={() => choose(null)}
          >
            <Icon name="x" size={16} />
          </button>
        </>
      )}
    </div>
  );
}
