/**
 * A Material 3 segmented button: one choice among a few, one tab stop, the arrow keys move between the
 * segments (Home and End jump to the ends).
 *  - `select` (a value in a form): a radio group; moving with the arrows chooses, as radios do.
 *  - `action` (choosing does something at once, like starting a reading): a group of toggle buttons;
 *    the arrows only move the focus and Enter or Space chooses, so passing over a segment does nothing.
 */
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './ui';

export type SegmentOption<T extends string> = { value: T; label: ReactNode; disabled?: boolean };

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  mode = 'select',
  disabled = false,
  className = '',
}: {
  /** The group's accessible name. */
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  mode?: 'select' | 'action';
  /**
   * All of it, while something runs. The segments stay focusable (aria-disabled), so the focus is not
   * lost while it waits.
   */
  disabled?: boolean;
  className?: string;
}) {
  const group = useRef<HTMLDivElement>(null);
  const enabled = options.filter((o) => !o.disabled);
  // The tab stop: the chosen segment, or the first one that can be used.
  const stop = enabled.some((o) => o.value === value) ? value : enabled[0]?.value;

  function onKeyDown(e: KeyboardEvent) {
    if (!enabled.length || disabled) return;
    const i = enabled.findIndex((o) => o.value === (document.activeElement as HTMLElement)?.dataset.value);
    const n = enabled.length;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? (i + 1) % n
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? (i - 1 + n) % n
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    const o = enabled[next]!;
    group.current?.querySelector<HTMLElement>(`[data-value="${o.value}"]`)?.focus();
    if (mode === 'select' && o.value !== value) onChange(o.value);
  }

  return (
    <div
      ref={group}
      className={`segmented ${className}`}
      role={mode === 'select' ? 'radiogroup' : 'group'}
      aria-label={label}
      aria-busy={disabled || undefined}
      onKeyDown={onKeyDown}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            data-value={o.value}
            role={mode === 'select' ? 'radio' : undefined}
            aria-checked={mode === 'select' ? on : undefined}
            aria-pressed={mode === 'action' ? on : undefined}
            className={on ? 'on' : ''}
            disabled={o.disabled}
            aria-disabled={disabled || undefined}
            tabIndex={o.value === stop ? 0 : -1}
            onClick={() => !on && !disabled && onChange(o.value)}
          >
            {on && <Icon name="check" size={16} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
