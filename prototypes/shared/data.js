/* OpenLibrary · datos de ejemplo y modelo compartido por los prototipos (web y Android).
   Los ISBN son de ejemplo (dígito de control válido, no necesariamente reales). */
(function () {
  'use strict';

  // ---------- ISBN ----------
  const cd13 = p => { let s = 0; for (let i = 0; i < 12; i++) s += (+p[i]) * (i % 2 ? 3 : 1); return String((10 - (s % 10)) % 10); };
  const mk = p => p + cd13(p);
  const to10 = c => {
    if (!c || !c.startsWith('978')) return null;
    const b = c.slice(3, 12); let s = 0;
    for (let i = 0; i < 9; i++) s += (+b[i]) * (10 - i);
    const d = (11 - (s % 11)) % 11; return b + (d === 10 ? 'X' : String(d));
  };
  function normalizeIsbn(raw) {
    const c = String(raw || '').toUpperCase().replace(/[^0-9X]/g, '');
    if (c.length === 13) {
      if (c.startsWith('977')) return { ok: false, code: c, reason: 'Es un ISSN (revista o publicación periódica), no un ISBN.' };
      if (c.startsWith('9790')) return { ok: false, code: c, reason: 'Es un ISMN (partitura), no un ISBN.' };
      if (!/^97[89]\d{10}$/.test(c)) return { ok: false, code: c, reason: 'Es un código de producto (EAN), no un ISBN.' };
      if (cd13(c.slice(0, 12)) !== c[12]) return { ok: false, code: c, reason: 'Dígito de control incorrecto: vuelve a escanear.' };
      return { ok: true, isbn13: c, isbn10: to10(c) };
    }
    if (c.length === 10) {
      let s = 0;
      for (let i = 0; i < 10; i++) { const ch = c[i]; if (ch === 'X' && i !== 9) return { ok: false, code: c, reason: 'ISBN-10 con formato inválido.' }; s += (ch === 'X' ? 10 : +ch) * (10 - i); }
      if (s % 11) return { ok: false, code: c, reason: 'Dígito de control incorrecto.' };
      return { ok: true, isbn13: mk('978' + c.slice(0, 9)), isbn10: c };
    }
    return { ok: false, code: c, reason: 'Longitud no válida: se esperan 10 o 13 dígitos.' };
  }
  const fmtIsbn = i => i && i.length === 13 ? `${i.slice(0, 3)}-${i.slice(3, 5)}-${i.slice(5, 9)}-${i.slice(9, 12)}-${i[12]}` : (i || '');

  // ---------- Ubicaciones ----------
  const LOCATIONS = [
    ['L1', 'Casa', null, 'home'],
    ['L2', 'Salón', 'L1', 'room'],
    ['L3', 'Estantería principal', 'L2', 'bookcase'],
    ['L4', 'Balda 1', 'L3', 'shelf'], ['L5', 'Balda 2', 'L3', 'shelf'], ['L6', 'Balda 3', 'L3', 'shelf'],
    ['L7', 'Mueble TV', 'L2', 'bookcase'],
    ['L8', 'Despacho', 'L1', 'room'],
    ['L9', 'Estantería IKEA', 'L8', 'bookcase'],
    ['L10', 'Balda superior', 'L9', 'shelf'], ['L11', 'Balda inferior', 'L9', 'shelf'],
    ['L12', 'Escritorio', 'L8', 'other'],
    ['L13', 'Dormitorio', 'L1', 'room'], ['L14', 'Mesilla', 'L13', 'other'],
    ['L15', 'Trastero', 'L1', 'room'], ['L16', 'Caja «Clásicos»', 'L15', 'box'],
  ];

  // ---------- Catálogo (obra → ediciones → ejemplares) ----------
  // r: lectura {st, s: inicio, e: fin, r: valoración, n: notas}
  const RAW = [
    { t: 'Cien años de soledad', a: ['Gabriel García Márquez'], g: ['Novela', 'Realismo mágico'], d: 'Siete generaciones de la familia Buendía en el pueblo de Macondo.', eds: [
      { pub: 'Debolsillo', y: 2014, l: 'es', pg: 496, p: '978849759246', f: 'Bolsillo', c: [{ loc: 'L6', cond: 'Bueno', acq: '2025-03-12', pr: 10.95, r: { st: 'read', s: '2025-04-02', e: '2025-05-10', r: 5, n: 'Relectura obligada cada pocos años.' } }] }] },
    { t: 'Don Quijote de la Mancha', a: ['Miguel de Cervantes'], g: ['Clásicos', 'Novela'], d: 'Las andanzas del hidalgo Alonso Quijano y su escudero Sancho Panza.', q: [['En un lugar de la Mancha, de cuyo nombre no quiero acordarme…', 1], ['La libertad, Sancho, es uno de los más preciosos dones que a los hombres dieron los cielos.', 984]], eds: [
      { sub: 'Edición del IV Centenario', pub: 'Alfaguara', y: 2015, l: 'es', pg: 1376, p: '978842041828', f: 'Tapa dura', c: [{ loc: 'L4', cond: 'Excelente', acq: '2024-12-20', pr: 29.9, r: { st: 'read', s: '2025-01-05', e: '2025-06-30', r: 5 } }] },
      { pub: 'Cátedra', y: 2005, l: 'es', pg: 1248, p: '978843762248', f: 'Tapa blanda (2 vols.)', c: [{ loc: 'L16', cond: 'Aceptable', acq: '2012-09-20', notes: 'Edición de estudio de la facultad, subrayada a lápiz.' }] }] },
    { t: 'La sombra del viento', a: ['Carlos Ruiz Zafón'], g: ['Novela', 'Misterio'], d: 'Daniel descubre en el Cementerio de los Libros Olvidados una novela que cambiará su vida.', eds: [
      { pub: 'Planeta', y: 2001, l: 'es', pg: 576, p: '978840809472', f: 'Tapa blanda', c: [{ loc: 'L5', cond: 'Bueno', acq: '2025-07-01', pr: 9.95, r: { st: 'read', s: '2025-07-03', e: '2025-07-20', r: 4 } }] }] },
    { t: 'Rayuela', a: ['Julio Cortázar'], g: ['Novela'], d: 'Una novela que puede leerse de varias maneras.', eds: [
      { pub: 'Cátedra', y: 2008, l: 'es', pg: 736, p: '978843760474', f: 'Bolsillo', c: [{ loc: 'L6', cond: 'Bueno', acq: '2026-09-14', pr: 14.5, r: { st: 'reading', s: '2026-10-20' } }] }] },
    { t: 'Ficciones', a: ['Jorge Luis Borges'], g: ['Relato', 'Clásicos'], d: 'Laberintos, bibliotecas infinitas y espejos.', eds: [
      { pub: 'Debolsillo', y: 2011, l: 'es', pg: 224, p: '978849989050', f: 'Bolsillo', c: [{ loc: 'L4', cond: 'Bueno', acq: '2025-02-02', pr: 8.95, r: { st: 'read', s: '2025-02-05', e: '2025-02-19', r: 5 } }] }] },
    { t: 'El nombre de la rosa', a: ['Umberto Eco'], g: ['Novela histórica', 'Misterio'], d: 'Crímenes en una abadía benedictina en el siglo XIV.', eds: [
      { pub: 'Lumen', y: 2005, l: 'es', pg: 784, p: '978842649765', f: 'Tapa blanda', c: [{ loc: 'L5', cond: 'Como nuevo', acq: '2026-06-10', pr: 12.3 }] }] },
    { t: '1984', a: ['George Orwell'], g: ['Distopía', 'Ciencia ficción'], d: 'Winston Smith y el Gran Hermano.', eds: [
      { pub: 'Debolsillo', y: 2013, l: 'es', pg: 352, p: '978849989103', f: 'Bolsillo', c: [
        { loc: 'L5', cond: 'Usado', acq: '2024-12-01', pr: 9.45, r: { st: 'read', s: '2025-01-10', e: '2025-01-28', r: 4 } },
        { loc: 'L14', cond: 'Como nuevo', acq: '2026-01-06', notes: 'Regalo de Reyes (repetido).' }] },
      { pub: 'Penguin Modern Classics', y: 2008, l: 'en', pg: 336, p: '978014103614', f: 'Paperback', c: [{ loc: 'L10', cond: 'Bueno', acq: '2025-08-22', pr: 11.0 }] }] },
    { t: 'Dune', a: ['Frank Herbert'], g: ['Ciencia ficción'], series: 'Dune', d: 'Arrakis, la especia y los Atreides.', eds: [
      { pub: 'Debolsillo', y: 2019, l: 'es', pg: 784, p: '978846634235', f: 'Bolsillo', c: [{ loc: 'L10', cond: 'Bueno', acq: '2026-10-02', pr: 12.95, r: { st: 'reading', s: '2026-10-28' } }] }] },
    { t: 'Sapiens', sub: 'De animales a dioses', a: ['Yuval Noah Harari'], g: ['Ensayo', 'Historia'], d: 'Breve historia de la humanidad.', eds: [
      { pub: 'Debate', y: 2015, l: 'es', pg: 496, p: '978849992622', f: 'Tapa blanda', c: [{ loc: 'L12', cond: 'Bueno', acq: '2025-05-18', pr: 22.9, r: { st: 'read', s: '2025-05-20', e: '2025-06-25', r: 4 } }] }] },
    { t: 'El Hobbit', a: ['J. R. R. Tolkien'], g: ['Fantasía'], d: 'Bilbo Bolsón parte en una aventura inesperada.', eds: [
      { pub: 'Minotauro', y: 2012, l: 'es', pg: 320, p: '978844500048', f: 'Tapa blanda', c: [{ loc: 'L11', cond: 'Usado', acq: '2025-10-30', pr: 6.0, notes: 'Comprado en la Cuesta de Moyano.', r: { st: 'read', s: '2025-11-01', e: '2025-11-15', r: 5 } }] }] },
    { t: 'El Señor de los Anillos', a: ['J. R. R. Tolkien'], g: ['Fantasía'], d: 'La Comunidad del Anillo, Las Dos Torres y El Retorno del Rey.', eds: [
      { pub: 'Minotauro', y: 2002, l: 'es', pg: 1392, p: '978844507330', f: 'Tapa dura', c: [{ loc: 'L11', cond: 'Bueno', acq: '2025-11-20', pr: 35.0 }] }] },
    { t: 'Crimen y castigo', a: ['Fiódor Dostoievski'], g: ['Clásicos', 'Novela'], d: 'Raskólnikov y las consecuencias de un crimen.', eds: [
      { pub: 'Alianza', y: 2015, l: 'es', pg: 688, p: '978842069685', f: 'Bolsillo', c: [{ loc: 'L16', cond: 'Aceptable', acq: '2026-02-14', pr: 4.0 }] }] },
    { t: 'Patria', a: ['Fernando Aramburu'], g: ['Novela'], d: 'Dos familias del País Vasco a lo largo de décadas.', eds: [
      { pub: 'Tusquets', y: 2016, l: 'es', pg: 648, p: '978849066319', f: 'Tapa blanda', c: [{ loc: 'L7', cond: 'Bueno', acq: '2026-03-03', pr: 22.9, r: { st: 'read', s: '2026-03-05', e: '2026-04-12', r: 4 } }] }] },
    { t: 'La casa de los espíritus', a: ['Isabel Allende'], g: ['Novela', 'Realismo mágico'], d: 'La saga de la familia Trueba.', eds: [
      { pub: 'Plaza & Janés', y: 2018, l: 'es', pg: 512, p: '978840105230', f: 'Tapa blanda', c: [{ loc: 'L6', cond: 'Bueno', acq: '2026-04-21', pr: 10.4 }] }] },
    { t: 'Los pilares de la Tierra', a: ['Ken Follett'], g: ['Novela histórica'], d: 'La construcción de una catedral en la Inglaterra del siglo XII.', eds: [
      { pub: 'Debolsillo', y: 2010, l: 'es', pg: 1040, p: '978840101552', f: 'Bolsillo', c: [{ loc: 'L7', cond: 'Usado', acq: '2025-09-09', pr: 5.0, r: { st: 'read', s: '2025-09-10', e: '2025-10-22', r: 3 } }] }] },
    { t: 'Pedro Páramo', a: ['Juan Rulfo'], g: ['Novela', 'Clásicos'], d: 'Juan Preciado viaja a Comala en busca de su padre.', eds: [
      { pub: 'Cátedra', y: 2005, l: 'es', pg: 160, p: '978843760449', f: 'Bolsillo', c: [{ loc: 'L4', cond: 'Bueno', acq: '2026-05-11', pr: 9.5, r: { st: 'read', s: '2026-05-12', e: '2026-05-15', r: 5 } }] }] },
    { t: 'El principito', a: ['Antoine de Saint-Exupéry'], g: ['Infantil', 'Clásicos'], d: 'Un aviador perdido en el desierto conoce a un pequeño príncipe.', eds: [
      { pub: 'Salamandra', y: 2008, l: 'es', pg: 96, p: '978847888944', f: 'Tapa dura', c: [{ loc: 'L14', cond: 'Bueno', acq: '2026-07-19', pr: 12.0, r: { st: 'read', s: '2026-07-20', e: '2026-07-20', r: 5 } }] }] },
    { t: 'Clean Code', sub: 'A Handbook of Agile Software Craftsmanship', a: ['Robert C. Martin'], g: ['Informática'], d: 'Buenas prácticas para escribir código legible.', eds: [
      { pub: 'Prentice Hall', y: 2008, l: 'en', pg: 464, p: '978013235088', f: 'Paperback', c: [{ loc: 'L12', cond: 'Usado', acq: '2026-08-08', pr: 28.0, r: { st: 'reading', s: '2026-09-01' } }] }] },
    { t: 'Fahrenheit 451', a: ['Ray Bradbury'], g: ['Ciencia ficción', 'Distopía'], d: 'Un bombero cuyo trabajo es quemar libros.', eds: [
      { pub: 'Minotauro', y: 2012, l: 'es', pg: 192, p: '978844503347', f: 'Tapa blanda', c: [{ loc: 'L10', cond: 'Bueno', acq: '2026-08-30', pr: 9.95 }] }] },
    { t: 'Niebla', a: ['Miguel de Unamuno'], g: ['Clásicos', 'Novela'], d: 'Augusto Pérez se enfrenta a su propio autor.', eds: [
      { pub: 'Cátedra', y: 2006, l: 'es', pg: 320, p: '978843760283', f: 'Bolsillo', noCover: true, c: [{ loc: 'L16', cond: 'Aceptable', acq: '2026-02-14', pr: 3.0, r: { st: 'read', s: '2026-02-20', e: '2026-03-01', r: 4 } }] }] },
    { t: 'La Regenta', a: ['Leopoldo Alas «Clarín»'], g: ['Clásicos', 'Novela'], d: 'Ana Ozores en la Vetusta de finales del XIX.', eds: [
      { pub: 'Daniel Cortezo y Cía.', y: 1884, l: 'es', pg: 1080, p: null, f: 'Tapa dura (2 tomos)', noCover: true, c: [{ loc: 'L16', cond: 'Deteriorado', acq: '2010-06-01', notes: 'Heredado del abuelo. Lomo despegado en el tomo II. Sin ISBN.' }] }] },
    { t: 'Kafka en la orilla', a: ['Haruki Murakami'], g: ['Novela'], d: 'Un adolescente huye de casa; un anciano habla con los gatos.', eds: [
      { pub: 'Tusquets', y: 2006, l: 'es', pg: 592, p: '978848383242', f: 'Tapa blanda', c: [{ loc: null, cond: 'Como nuevo', acq: '2026-10-25', pr: 21.0, notes: 'Aún en la mochila, sin colocar.' }] }] },
    { t: 'Ensayo sobre la ceguera', a: ['José Saramago'], g: ['Novela', 'Distopía'], d: 'Una epidemia de ceguera blanca se extiende por la ciudad.', eds: [
      { pub: 'Alfaguara', y: 2010, l: 'es', pg: 448, p: '978842042820', f: 'Tapa blanda', c: [{ loc: 'L5', cond: 'Bueno', acq: '2025-12-12', pr: 19.5, r: { st: 'read', s: '2025-12-15', e: '2026-01-08', r: 5 } }] }] },
    { t: 'Momo', a: ['Michael Ende'], g: [], d: '', eds: [
      { pub: '', y: null, l: 'es', pg: null, p: '978842044689', f: '', noCover: true, prov: true, c: [{ loc: 'L14', cond: 'Bueno', acq: '2026-11-02' }] }] },
  ];

  const WISHLIST = [
    { t: 'El infinito en un junco', a: 'Irene Vallejo', isbn: mk('978849838144'), n: 'Recomendado por Ana. Tapa dura si es posible.', pri: 'alta' },
    { t: 'Los detectives salvajes', a: 'Roberto Bolaño', n: 'Buscar en librerías de segunda mano.', pri: 'media' },
    { t: 'Don Quijote — ilustrado por Gustave Doré', a: 'Miguel de Cervantes', work: 'Don Quijote de la Mancha', n: 'Otra edición de una obra que ya tengo.', pri: 'baja' },
    { t: 'El mesías de Dune', a: 'Frank Herbert', n: 'Cuando termine Dune.', pri: 'media' },
    { t: 'Proyecto Hail Mary', a: 'Andy Weir', n: '', pri: 'baja' },
  ];

  // ---------- Proveedor de metadatos simulado ----------
  const PROVIDER = {
    [mk('978849838144')]: { title: 'El infinito en un junco', subtitle: 'La invención de los libros en el mundo antiguo', authors: ['Irene Vallejo'], publisher: 'Siruela', year: 2019, lang: 'es', pages: 452, genres: ['Ensayo', 'Historia'], description: 'Un viaje por la historia del libro en la Antigüedad.', source: 'Open Library', hasCover: true },
    [mk('978843397187')]: { title: 'Los detectives salvajes', subtitle: '', authors: ['Roberto Bolaño'], publisher: 'Anagrama', year: 1998, lang: 'es', pages: 624, genres: ['Novela'], description: 'La búsqueda de una poeta desaparecida.', source: 'Google Books', hasCover: true },
    [mk('978843222147')]: { title: 'La ridícula idea de no volver a verte', subtitle: '', authors: ['Rosa Montero'], publisher: 'Seix Barral', year: 2013, lang: 'es', pages: 240, genres: ['Ensayo', 'Biografía'], description: 'A partir del diario de Marie Curie, una reflexión sobre el duelo.', source: 'Open Library', hasCover: true },
  };
  PROVIDER[mk('978842044689')] = { title: 'Momo', subtitle: '', authors: ['Michael Ende'], publisher: 'Alfaguara', year: 1985, lang: 'es', pages: 296, genres: ['Fantasía', 'Infantil'], description: 'Una niña que sabe escuchar se enfrenta a los hombres grises que roban el tiempo.', source: 'Open Library', hasCover: true };
  const ISBN_1984 = mk('978849989103');
  const goodIsbn = mk('978843222147');
  const SCAN_SCENARIOS = [
    { id: 'new', label: 'Libro nuevo con datos', hint: 'Rosa Montero · Open Library', code: goodIsbn },
    { id: 'wish', label: 'Libro de tu lista de deseos', hint: 'El infinito en un junco', code: mk('978849838144') },
    { id: 'dup', label: 'Edición que ya tienes', hint: '1984 · Debolsillo', code: ISBN_1984 },
    { id: 'none', label: 'ISBN sin resultados', hint: 'ningún proveedor lo conoce', code: mk('978841999990') },
    { id: 'issn', label: 'Código de una revista', hint: 'ISSN 977…', code: '9770212345007' },
    { id: 'bad', label: 'Lectura defectuosa', hint: 'dígito de control erróneo', code: goodIsbn.slice(0, 12) + ((+goodIsbn[12] + 3) % 10) },
  ];

  // ---------- Estado ----------
  let seq = 1000;
  const uid = p => `${p}${++seq}`;

  function createState() {
    const S = { works: [], editions: [], copies: [], sessions: [], quotes: [], wishlist: [], conflicts: [],
      locations: LOCATIONS.map(([id, name, parent, kind]) => ({ id, name, parent, kind })) };
    let w = 0, e = 0, c = 0, s = 0;
    RAW.forEach(r => {
      const work = { id: `w${++w}`, title: r.t, subtitle: r.sub || '', authors: r.a, genres: r.g, description: r.d, series: r.series || '' };
      S.works.push(work);
      (r.q || []).forEach(([text, page]) => S.quotes.push({ id: uid('q'), workId: work.id, text, page }));
      r.eds.forEach(ed => {
        const isbn13 = ed.p ? mk(ed.p) : null;
        const edition = { id: `e${++e}`, workId: work.id, title: '', subtitle: ed.sub || '', publisher: ed.pub, year: ed.y, lang: ed.l, pages: ed.pg,
          isbn13, isbn10: isbn13 ? to10(isbn13) : null, format: ed.f, hasCover: !ed.noCover, coverOrigin: ed.noCover ? null : 'provider',
          metaStatus: ed.prov ? 'provisional' : 'complete', source: ed.prov ? '—' : (ed.p ? (e % 3 ? 'Open Library' : 'Google Books') : 'Manual') };
        S.editions.push(edition);
        ed.c.forEach(cp => {
          const copy = { id: `c${++c}`, code: `EJ-${String(c).padStart(4, '0')}`, editionId: edition.id, locationId: cp.loc, condition: cp.cond,
            acquired: cp.acq, price: cp.pr ?? null, notes: cp.notes || '', retired: false };
          S.copies.push(copy);
          if (cp.r) S.sessions.push({ id: `s${++s}`, copyId: copy.id, status: cp.r.st, start: cp.r.s || null, end: cp.r.e || null, rating: cp.r.r || 0, notes: cp.r.n || '' });
        });
      });
    });
    WISHLIST.forEach((x, i) => S.wishlist.push({ id: `d${i + 1}`, title: x.t, author: x.a, isbn13: x.isbn || null,
      workId: x.work ? (S.works.find(w => w.title === x.work) || {}).id : null, notes: x.n, priority: x.pri, acquired: false }));
    return S;
  }

  // ---------- Consultas y mutaciones ----------
  function api(S) {
    const A = {
      work: id => S.works.find(x => x.id === id),
      ed: id => S.editions.find(x => x.id === id),
      copy: id => S.copies.find(x => x.id === id),
      loc: id => S.locations.find(x => x.id === id),
      edsOfWork: wid => S.editions.filter(x => x.workId === wid),
      copiesOfEd: eid => S.copies.filter(x => x.editionId === eid && !x.retired),
      copiesOfWork: wid => A.edsOfWork(wid).flatMap(x => A.copiesOfEd(x.id)),
      ownedEditions: () => S.editions.filter(x => A.copiesOfEd(x.id).length),
      ownedWorks: () => S.works.filter(x => A.copiesOfWork(x.id).length),
      sessions: cid => S.sessions.filter(x => x.copyId === cid),
      latest: cid => { const ss = A.sessions(cid); return ss[ss.length - 1] || null; },
      copyStatus: cid => (A.latest(cid) || {}).status || 'pending',
      agg(copies) {
        if (copies.some(c => A.copyStatus(c.id) === 'reading')) return 'reading';
        if (copies.some(c => A.sessions(c.id).some(s => s.status === 'read'))) return 'read';
        return 'pending';
      },
      edStatus: eid => A.agg(A.copiesOfEd(eid)),
      workStatus: wid => A.agg(A.copiesOfWork(wid)),
      rating(copies) { const r = copies.flatMap(c => A.sessions(c.id)).filter(s => s.rating).map(s => s.rating); return r.length ? r[r.length - 1] : 0; },
      locChildren: id => S.locations.filter(l => l.parent === id),
      locPath(id, skipRoot = true) {
        if (!id) return [];
        const out = []; let l = A.loc(id);
        while (l) { out.unshift(l.name); l = l.parent ? A.loc(l.parent) : null; }
        return skipRoot ? out.slice(1) : out;
      },
      locDesc(id) { const out = [id]; A.locChildren(id).forEach(c => out.push(...A.locDesc(c.id))); return out; },
      copiesIn(id, deep = true) {
        if (id === 'none') return S.copies.filter(c => !c.retired && !c.locationId);
        const set = new Set(deep ? A.locDesc(id) : [id]);
        return S.copies.filter(c => !c.retired && set.has(c.locationId));
      },
      findByIsbn: i => S.editions.find(x => x.isbn13 === i),
      wishByIsbn: i => S.wishlist.find(x => x.isbn13 === i && !x.acquired),
      lookup: i => PROVIDER[i] ? JSON.parse(JSON.stringify(PROVIDER[i])) : null,
      blob(eid) {
        const e = A.ed(eid), w = A.work(e.workId);
        return norm([w.title, w.subtitle, e.subtitle, w.authors.join(' '), e.publisher, e.isbn13, e.isbn10, w.genres.join(' '), w.series,
          A.copiesOfEd(eid).map(c => A.locPath(c.locationId).join(' ')).join(' ')].join(' '));
      },
      // Búsqueda: si la frase completa aparece en algún libro, solo esos; si no, todos los términos por separado.
      search(eds, q) {
        const nq = norm(q).trim().replace(/\s+/g, ' ');
        if (!nq) return eds;
        const phrase = eds.filter(e => A.blob(e.id).includes(nq));
        if (phrase.length) return phrase;
        const terms = nq.split(' ');
        return eds.filter(e => { const b = A.blob(e.id); return terms.every(t => b.includes(t)); });
      },
      setStatus(cid, st) {
        const today = TODAY;
        const last = A.latest(cid);
        if (!last) { S.sessions.push({ id: uid('s'), copyId: cid, status: st, start: st !== 'pending' ? today : null, end: st === 'read' ? today : null, rating: 0, notes: '' }); return; }
        if (last.status === 'read' && st === 'reading') { S.sessions.push({ id: uid('s'), copyId: cid, status: 'reading', start: today, end: null, rating: 0, notes: '' }); return 'reread'; }
        last.status = st;
        if (st === 'reading' && !last.start) last.start = today;
        if (st === 'read') { if (!last.start) last.start = today; last.end = today; }
        if (st === 'pending') { last.start = null; last.end = null; }
      },
      setRating(cid, r) {
        let last = A.latest(cid);
        if (!last) { last = { id: uid('s'), copyId: cid, status: 'pending', start: null, end: null, rating: 0, notes: '' }; S.sessions.push(last); }
        last.rating = r;
      },
      addCopy(eid, d = {}) {
        const n = S.copies.length + 1;
        const copy = { id: uid('c'), code: d.offline ? `TMP-${String(seq).slice(-4)}` : `EJ-${String(n).padStart(4, '0')}`, editionId: eid, locationId: d.locationId || null,
          condition: d.condition || 'Bueno', acquired: d.acquired || TODAY, price: d.price ?? null, notes: d.notes || '', retired: false };
        S.copies.push(copy);
        if (d.status && d.status !== 'pending') A.setStatus(copy.id, d.status);
        return copy;
      },
      addBook(m, d = {}) {
        let work = m.workId ? A.work(m.workId) : null;
        if (!work) { work = { id: uid('w'), title: m.title, subtitle: m.subtitle || '', authors: m.authors || [], genres: m.genres || [], description: m.description || '', series: '' }; S.works.push(work); }
        const ed = { id: uid('e'), workId: work.id, title: '', subtitle: m.workId ? (m.subtitle || '') : '', publisher: m.publisher || '', year: m.year || null, lang: m.lang || 'es', pages: m.pages || null,
          isbn13: m.isbn13 || null, isbn10: m.isbn13 ? to10(m.isbn13) : null, format: m.format || '', hasCover: !!m.hasCover, coverOrigin: m.coverOrigin || (m.hasCover ? 'provider' : null),
          metaStatus: m.provisional ? 'provisional' : 'complete', source: m.source || 'Manual' };
        S.editions.push(ed);
        const copy = A.addCopy(ed.id, d);
        if (m.wishId) { const wi = S.wishlist.find(x => x.id === m.wishId); if (wi) { wi.acquired = true; wi.copyId = copy.id; } }
        return { work, ed, copy };
      },
      stats() {
        const works = A.ownedWorks(), copies = S.copies.filter(c => !c.retired);
        const count = (arr) => Object.entries(arr.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]);
        const byStatusWorks = { pending: 0, reading: 0, read: 0 }; works.forEach(w => byStatusWorks[A.workStatus(w.id)]++);
        const byStatusCopies = { pending: 0, reading: 0, read: 0 }; copies.forEach(c => byStatusCopies[A.copyStatus(c.id)]++);
        const months = []; for (let i = 11; i >= 0; i--) { const d = new Date(2026, 10 - i, 1); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
        const added = months.map(m => [m, copies.filter(c => (c.acquired || '').startsWith(m)).length]);
        return {
          works: works.length, editions: A.ownedEditions().length, copies: copies.length,
          authors: new Set(works.flatMap(w => w.authors)).size,
          pages: copies.filter(c => A.sessions(c.id).some(s => s.status === 'read')).reduce((t, c) => t + (A.ed(c.editionId).pages || 0), 0),
          byGenre: count(works.flatMap(w => w.genres.length ? w.genres : ['Sin género'])),
          byAuthor: count(works.flatMap(w => w.authors)),
          byRoom: count(copies.map(c => A.locPath(c.locationId)[0] || 'Sin ubicación')),
          byStatusWorks, byStatusCopies, added,
          value: copies.reduce((t, c) => t + (c.price || 0), 0),
        };
      },
    };
    return A;
  }

  const TODAY = '2026-11-04';
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // ---------- Portadas generadas ----------
  const PALETTES = [
    ['#7a2e2e', '#e8c07d', '#fdf6e9'], ['#1f3a5f', '#e9b44c', '#f4efe6'], ['#2f4f3a', '#d9a441', '#f3eee2'], ['#3b2a4f', '#f0a04b', '#f6f0ff'],
    ['#0f4c5c', '#e36414', '#fbf5ec'], ['#5c3d2e', '#c9a227', '#f7efe1'], ['#8c1c13', '#f2e8cf', '#f2e8cf'], ['#264653', '#e9c46a', '#f1faee'],
    ['#283618', '#dda15e', '#fefae0'], ['#3d405b', '#f2cc8f', '#f4f1de'], ['#6d2e46', '#d5b9b2', '#fbf0ec'], ['#14213d', '#fca311', '#e5e5e5'],
  ];
  const hash = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return Math.abs(h); };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function cover(ed, work, extra = '') {
    const title = esc((ed && ed.title) || (work && work.title) || 'Sin título');
    const author = esc(((work && work.authors) || []).join(', '));
    const prov = ed && ed.metaStatus === 'provisional';
    if (!ed || !ed.hasCover) {
      return `<div class="olc ph ${prov ? 'prov' : ''} ${extra}" aria-label="Sin portada: ${title}">
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/></svg>
        <div class="olc-t">${title}</div><div class="olc-a">${author}</div>${prov ? '<div class="tag">Provisional</div>' : ''}</div>`;
    }
    const h = hash((ed.id || '') + title);
    const [bg, ac, ink] = PALETTES[h % PALETTES.length];
    const st = (h >> 4) % 4;
    const deco = ['<div class="band"></div>', '<div class="fr"></div>', '<div class="ci"></div>', '<div class="st"></div>'][st];
    return `<div class="olc s${st} ${extra}" style="--bg:${bg};--ac:${ac};--ink:${ink}" aria-label="Portada: ${title}">${deco}<div class="olc-t">${title}</div><div class="olc-a">${author}</div>${ed.coverOrigin === 'photo' ? '<div class="tag">Foto</div>' : ''}</div>`;
  }
  const css = `
  .olc{position:relative;aspect-ratio:2/3;width:100%;border-radius:2px 5px 5px 2px;overflow:hidden;container-type:inline-size;background:var(--bg);color:var(--ink);
    font-family:'Fraunces',Georgia,serif;box-shadow:0 1px 2px rgba(0,0,0,.18),0 8px 18px -8px rgba(0,0,0,.45);flex:none}
  .olc::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.25) 0,rgba(255,255,255,.12) 2.5%,rgba(0,0,0,.05) 6%,transparent 9%);pointer-events:none}
  .olc .olc-t{position:absolute;left:11cqw;right:10cqw;font-weight:600;line-height:1.04;font-size:12.5cqw;letter-spacing:-.01em;text-wrap:balance}
  .olc .olc-a{position:absolute;left:11cqw;right:10cqw;font-family:Inter,system-ui,sans-serif;font-size:6.4cqw;letter-spacing:.07em;text-transform:uppercase;opacity:.85;line-height:1.2}
  .olc.s0 .band{position:absolute;left:0;right:0;top:60%;height:6%;background:var(--ac)} .olc.s0 .olc-t{top:13cqw} .olc.s0 .olc-a{bottom:11cqw}
  .olc.s1 .fr{position:absolute;inset:6cqw;border:1.3cqw solid var(--ac)} .olc.s1 .olc-t{top:34%;text-align:center} .olc.s1 .olc-a{bottom:15cqw;text-align:center}
  .olc.s2 .ci{position:absolute;width:95cqw;height:95cqw;border-radius:50%;background:var(--ac);right:-35cqw;bottom:-28cqw;opacity:.92} .olc.s2 .olc-a{top:11cqw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} .olc.s2 .olc-t{top:24cqw}
  .olc.s3 .st{position:absolute;top:0;bottom:0;left:14cqw;width:8cqw;background:var(--ac)} .olc.s3 .olc-t{left:31cqw;top:14cqw} .olc.s3 .olc-a{left:31cqw;bottom:11cqw}
  .olc.ph{background:repeating-linear-gradient(135deg,#ebe5d9 0 7px,#e4ddcf 7px 14px);color:#6b6357;box-shadow:inset 0 0 0 1px rgba(0,0,0,.06),0 6px 14px -8px rgba(0,0,0,.35)}
  .olc.ph .ic{position:absolute;left:50%;top:22%;width:30cqw;transform:translateX(-50%);opacity:.55}
  .olc.ph .olc-t{top:auto;bottom:22cqw;text-align:center;font-size:11cqw} .olc.ph .olc-a{bottom:9cqw;text-align:center;font-size:5.6cqw}
  .olc.prov{outline:1.6cqw dashed #c48a2c;outline-offset:-3.5cqw}
  .olc .tag{position:absolute;top:6cqw;right:6cqw;font:600 6cqw/1.4 Inter,system-ui,sans-serif;background:rgba(0,0,0,.6);color:#fff;padding:.8cqw 3.5cqw;border-radius:99px;letter-spacing:.02em}
  .olc.ph .tag{background:#c48a2c}`;
  const styleEl = document.createElement('style'); styleEl.textContent = css; document.head.appendChild(styleEl);

  window.OL = { createState, api, cover, normalizeIsbn, fmtIsbn, norm, esc, uid, TODAY, SCAN_SCENARIOS, mk };
})();
