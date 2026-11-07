/**
 * Genres of a book as removable chips plus an input: type a new one and press Enter, or pick one the
 * user already uses (the facets' subjects). Kept as the form's semicolon-separated string.
 */
import { useId, useState, type KeyboardEvent } from 'react';
import { splitList } from '../lib/format';
import { useI18n } from '../i18n';

const normalize = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

export function SubjectsInput({
  value,
  onChange,
  suggestions,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Every genre already used in the library, from GET /library/facets. */
  suggestions: readonly string[];
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = splitList(value);
  const taken = new Set(selected.map(normalize));
  const query = normalize(text.trim());
  const available = suggestions.filter((s) => !taken.has(normalize(s)));
  const matches = (query ? available.filter((s) => normalize(s).includes(query)) : available).slice(0, 8);

  function commit(raw: string) {
    const name = raw.trim();
    if (!name) return;
    if (!taken.has(normalize(name))) onChange([...selected, name].join('; '));
    setText('');
    setOpen(false);
    setActive(0);
  }

  function remove(name: string) {
    onChange(selected.filter((s) => s !== name).join('; '));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      // Do not submit the form: Enter is how a genre is added.
      e.preventDefault();
      commit(matches[active] ?? text);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!matches.length) return;
      e.preventDefault();
      setOpen(true);
      setActive((i) =>
        e.key === 'ArrowDown' ? (i + 1) % matches.length : (i - 1 + matches.length) % matches.length,
      );
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Backspace' && !text && selected.length) {
      remove(selected[selected.length - 1]!);
    }
  }

  return (
    <div className="field subject-field">
      <label className="field-label" htmlFor={id}>
        {t('book.subjects')}
      </label>
      <div className="subject-box">
        {selected.map((s) => (
          <span key={s} className="chip subject-chip">
            {s}
            <button
              type="button"
              className="subject-remove"
              aria-label={`${t('common.remove')}: ${s}`}
              onClick={() => remove(s)}
              disabled={disabled}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && matches.length > 0}
          aria-controls={listId}
          aria-activedescendant={open && matches.length ? `${listId}-${active}` : undefined}
          value={text}
          placeholder={t('form.subjectsPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => {
            // Typing a genre and clicking Save must not lose it.
            if (text.trim()) commit(text);
            setOpen(false);
          }}
          onKeyDown={onKeyDown}
        />
        {open && matches.length > 0 && (
          <ul id={listId} className="subject-options" role="listbox">
            {matches.map((s, i) => (
              <li
                key={s}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'on' : ''}
                // mousedown keeps the input focused; the click would blur and commit the typed text first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(s);
                }}
              >
                {s}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
