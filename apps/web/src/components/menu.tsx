/**
 * A menu button with a single choice (WAI-ARIA menu button pattern, `menuitemradio` items): the filter
 * chips and the sort menu of the library. Enter, Space or the arrows open it on the chosen item; the
 * arrows, Home and End move; a letter jumps to the next item that starts with it; Escape closes it and
 * gives the focus back to the button; Tab or a click elsewhere closes it.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { foldSearch } from '../lib/recent';
import { Icon } from './ui';

export type MenuItem = { value: string; label: string; depth?: number };

export function SelectMenu({
  name,
  items,
  value,
  onChange,
  children,
  active = false,
  align = 'start',
}: {
  /** What is chosen (the menu's name and part of the button's when something is chosen). */
  name: string;
  items: MenuItem[];
  value: string;
  onChange: (value: string) => void;
  /** The button's visible content. */
  children: ReactNode;
  /** A filter is applied: the chip is shown selected. */
  active?: boolean;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const buttonId = useId();
  /** Which item takes the focus once the menu is in the page. */
  const [focusAt, setFocusAt] = useState<'checked' | 'first' | 'last'>('checked');

  const menu = useRef<HTMLDivElement>(null);
  // Kept inside the window: a menu that would run past the right edge moves left (narrow screens).
  useLayoutEffect(() => {
    const m = menu.current;
    if (!open || !m) return;
    m.style.translate = '';
    const r = m.getBoundingClientRect();
    const margin = 8;
    const shift =
      r.right > innerWidth - margin ? innerWidth - margin - r.right : r.left < margin ? margin - r.left : 0;
    if (shift) m.style.translate = `${Math.max(shift, margin - r.left)}px 0`;
  }, [open]);

  const itemEls = () => [...(wrap.current?.querySelectorAll<HTMLElement>('[role=menuitemradio]') ?? [])];

  useEffect(() => {
    if (!open) return;
    const els = itemEls();
    const checked = els.findIndex((el) => el.getAttribute('aria-checked') === 'true');
    const i = focusAt === 'first' ? 0 : focusAt === 'last' ? els.length - 1 : Math.max(0, checked);
    els[i]?.focus();
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, focusAt]);

  const openAt = (at: 'checked' | 'first' | 'last') => {
    setFocusAt(at);
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  function onButtonKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openAt(e.key === 'ArrowDown' ? 'checked' : 'last');
    }
  }

  function onMenuKey(e: KeyboardEvent) {
    const els = itemEls();
    const i = els.indexOf(document.activeElement as HTMLElement);
    const move = (n: number) => {
      e.preventDefault();
      els[(n + els.length) % els.length]?.focus();
    };
    if (e.key === 'ArrowDown') move(i + 1);
    else if (e.key === 'ArrowUp') move(i - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(els.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      // The item with the focus is about to go: Tab carries on from the button instead.
      button.current?.focus();
      setOpen(false);
    } else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Type-ahead: the next item whose label starts with the letter.
      const k = foldSearch(e.key);
      const order = [...els.slice(i + 1), ...els.slice(0, i + 1)];
      const hit = order.find((el) => foldSearch(el.textContent ?? '').startsWith(k));
      if (hit) {
        e.preventDefault();
        hit.focus();
      }
    }
  }

  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        ref={button}
        id={buttonId}
        type="button"
        className={`chip-btn ${active ? 'on' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openAt('checked'))}
        onKeyDown={onButtonKey}
      >
        {active && <Icon name="check" size={16} />}
        {children}
        <Icon name="chevDown" size={16} />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          id={menuId}
          aria-label={name}
          className={`menu ${align === 'end' ? 'end' : ''}`}
          onKeyDown={onMenuKey}
        >
          {items.map((it) => (
            <button
              key={it.value}
              type="button"
              role="menuitemradio"
              aria-checked={it.value === value}
              tabIndex={-1}
              style={it.depth ? { paddingInlineStart: `${0.857 + it.depth}rem` } : undefined}
              onClick={() => {
                onChange(it.value);
                close(true);
              }}
            >
              <span className="menu-check" aria-hidden>
                {it.value === value && <Icon name="check" size={16} />}
              </span>
              <span className="menu-label">{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
