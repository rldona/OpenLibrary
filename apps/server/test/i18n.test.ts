import { describe, expect, it } from 'vitest';
import { LANGS, pickLang, SHARED } from '@openlibrary/contracts';
import { SERVER_MESSAGES } from '../src/i18n.js';
import { makeApp, ORIGIN, webClient } from './helpers.js';

describe('i18n', () => {
  it('every message key exists in every language', () => {
    for (const dict of [SHARED, SERVER_MESSAGES]) {
      const keys = (l: (typeof LANGS)[number]) => Object.keys(dict[l]).sort();
      for (const l of LANGS) expect(keys(l)).toEqual(keys('en'));
    }
  });

  it('negotiates the language from Accept-Language', () => {
    expect(pickLang(undefined)).toBe('en');
    expect(pickLang('es-ES,es;q=0.9,en;q=0.8')).toBe('es');
    expect(pickLang('fr-FR,fr;q=0.9,es;q=0.5')).toBe('es');
    expect(pickLang('de, en;q=0.1')).toBe('en');
    expect(pickLang('es;q=0, en')).toBe('en');
  });

  it('answers errors in the requested language (English by default)', async () => {
    const { app } = await makeApp();
    const login = (lang?: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: ORIGIN, ...(lang ? { 'accept-language': lang } : {}) },
        payload: { password: 'nope' },
      });
    const en = await login();
    expect(en.json()).toMatchObject({
      title: 'Not authenticated',
      detail: 'Wrong password.',
      code: 'unauthorized',
    });
    expect(en.headers['content-language']).toBe('en');
    const es = await login('es-ES,es;q=0.9');
    expect(es.json()).toMatchObject({ title: 'No autenticado', detail: 'Contraseña incorrecta.' });
  });

  it('translates validation messages, including our own keys and zod built-ins', async () => {
    const { app } = await makeApp();
    const c = await webClient(app);
    const post = (lang: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/books',
        headers: { origin: ORIGIN, 'accept-language': lang },
        cookies: { ol_session: c.token },
        payload: { work: { title: '' }, edition: { isbn13: '9770212345007' }, copy: {} },
      });
    const en = (await post('en')).json().detail as string;
    expect(en).toContain('The title is required.');
    expect(en).toContain('This is an ISSN');
    const es = (await post('es')).json().detail as string;
    expect(es).toContain('El título es obligatorio.');
    expect(es).toContain('Es un ISSN');
  });
});
