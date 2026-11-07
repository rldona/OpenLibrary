/** Loading, empty and error states shared by every view. */
import { useEffect, useState, type ReactNode } from 'react';
import { errorText } from '../api';
import { useI18n } from '../i18n';
import { Icon } from './ui';

/** Waits `ms` before showing anything, so a fast answer never flashes a spinner. */
export function useDelayed(ms = 300) {
  const [shown, setShown] = useState(ms <= 0);
  useEffect(() => {
    if (ms <= 0) return;
    const timer = window.setTimeout(() => setShown(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return shown;
}

export function Spinner({ small, current }: { small?: boolean; current?: boolean }) {
  return <span className={`spinner ${small ? 'sm' : ''} ${current ? 'current' : ''}`} aria-hidden />;
}

/**
 * A button's label while its action runs: a small spinner in the text colour and the busy text. The
 * button itself should be disabled meanwhile.
 */
export function BusyLabel({
  busy,
  busyText,
  children,
}: {
  busy: boolean;
  busyText: string;
  children: ReactNode;
}) {
  return busy ? (
    <>
      <Spinner small current />
      {busyText}
    </>
  ) : (
    <>{children}</>
  );
}

/** A circular progress indicator and its text, after a short delay. */
export function LoadingState({
  label,
  delay = 300,
  compact,
}: {
  label?: string;
  delay?: number;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const shown = useDelayed(delay);
  return (
    <div className={`state ${compact ? 'compact inline' : ''}`} role="status">
      {shown && (
        <>
          <Spinner small={compact} />
          <span>{label ?? t('common.loading')}</span>
        </>
      )}
    </div>
  );
}

/** The shape of the cover grid while the library's first page loads. */
export function GridSkeleton({ count = 12, delay = 300 }: { count?: number; delay?: number }) {
  const { t } = useI18n();
  const shown = useDelayed(delay);
  return (
    <div role="status">
      <span className="sr-only">{t('common.loading')}</span>
      {shown && (
        <div className="grid skeleton" aria-hidden>
          {Array.from({ length: count }, (_, i) => (
            <div key={i}>
              <div className="sk cover-sk" />
              <div className="sk line" />
              <div className="sk line short" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function EmptyState({
  icon = 'book',
  title,
  text,
  action,
  compact,
}: {
  icon?: string;
  title: string;
  text?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty state ${compact ? 'compact' : ''}`}>
      <span className="state-icon" aria-hidden>
        <Icon name={icon} size={24} />
      </span>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

/** What failed and a way to try again (a query's `refetch`). */
export function ErrorState({
  error,
  message,
  onRetry,
  compact,
}: {
  error?: unknown;
  message?: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className={`state error ${compact ? 'compact' : ''}`} role="alert">
      <span className="state-icon" aria-hidden>
        <Icon name="warn" size={24} />
      </span>
      <h3>{message ?? t('state.errorTitle')}</h3>
      {error !== undefined && <p>{errorText(error, t)}</p>}
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}
