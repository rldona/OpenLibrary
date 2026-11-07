/**
 * The app's main navigation in its three forms (lib/media.ts): the side menu (≥ 1200 px), a navigation
 * rail (600–1199 px) and a bottom navigation bar (< 600 px). The bar carries the five main destinations;
 * "Import and export" and "Sign out" are under Settings there.
 */
import { navigate } from '../lib/router';
import type { NavMode } from '../lib/media';
import { LanguageSwitch, useI18n } from '../i18n';
import { Icon, Logo } from './ui';

export type View = 'library' | 'favorites' | 'locations' | 'wishlist' | 'stats' | 'data' | 'settings';

type Dest = { view: View; to: string; icon: string; label: string; short: string; count?: number };

export function MainNav({
  mode,
  view,
  counts,
  onSignOut,
}: {
  mode: NavMode;
  view: View;
  counts: Partial<Record<View, number>>;
  onSignOut: () => void;
}) {
  const { t } = useI18n();
  const dest = (v: View, to: string, icon: string, label: string, short = label): Dest => ({
    view: v,
    to,
    icon,
    label,
    short,
    count: counts[v],
  });
  const main = [
    dest('library', '/', 'book', t('nav.library')),
    dest('favorites', '/favorites', 'heart', t('nav.favorites')),
    dest('locations', '/locations', 'tree', t('nav.locations')),
    dest('wishlist', '/wishlist', 'list', t('nav.wishlist'), t('nav.wishlistShort')),
    dest('stats', '/stats', 'chart', t('nav.stats')),
  ];
  const data = dest('data', '/data', 'download', t('nav.data'), t('nav.dataShort'));
  const settings = dest('settings', '/settings', 'gear', t('nav.settings'));

  // On the bottom bar, "Import and export" lives under Settings, which stays marked there.
  const shown = mode === 'bar' && view === 'data' ? 'settings' : view;
  const link = (d: Dest) => (
    <a
      key={d.view}
      href={d.to}
      className={`nav ${shown === d.view ? 'on' : ''}`}
      aria-current={shown === d.view ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault();
        navigate(d.to);
      }}
    >
      <span className="nav-icon">
        <Icon name={d.icon} />
        {mode !== 'drawer' && !!d.count && (
          <span className="badge-n" aria-hidden>
            {d.count}
          </span>
        )}
      </span>
      <span className="nav-label">{mode === 'drawer' ? d.label : d.short}</span>
      {/* The badge sits on the icon; its number is read after the name. */}
      {/* A space between the name and the number, so they are read as two words. */}
      {d.count !== undefined && ' '}
      {mode !== 'drawer' && !!d.count && <span className="sr-only">{d.count}</span>}
      {mode === 'drawer' && d.count !== undefined && <span className="n">{d.count}</span>}
    </a>
  );

  if (mode === 'bar')
    return (
      <nav className="bottom-bar" aria-label={t('a11y.mainNav')}>
        {[...main, settings].map(link)}
      </nav>
    );

  const signOut = (
    <button className="nav" onClick={onSignOut}>
      <span className="nav-icon">
        <Icon name="logout" />
      </span>
      <span className="nav-label">{t('nav.logout')}</span>
    </button>
  );

  return (
    <aside className={mode === 'rail' ? 'side rail' : 'side'}>
      <a
        className="brand"
        href="/"
        onClick={(e) => {
          e.preventDefault();
          navigate('/');
        }}
      >
        <Logo className="logo" />
        {mode === 'drawer' && 'OpenLibrary'}
      </a>
      <nav aria-label={t('a11y.mainNav')}>
        {main.map(link)}
        {mode === 'drawer' && <div className="sep" />}
        {link(data)}
        {link(settings)}
      </nav>
      {signOut}
      <div className="foot">
        <LanguageSwitch />
      </div>
    </aside>
  );
}
