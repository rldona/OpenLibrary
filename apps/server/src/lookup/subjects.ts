import type { Lang } from '@openlibrary/contracts';

/**
 * Open Library and Google Books only give subjects in English. When a lookup answers a Spanish client,
 * the usual ones (Google Books' BISAC headings and frequent Open Library subjects) are translated before
 * they reach the book form; unknown subjects stay as they came and the owner can edit them.
 * Google Books' "Fiction / Science Fiction / General" headings are translated part by part.
 */
const ES: Record<string, string> = {
  // Google Books (BISAC top-level headings)
  'antiques & collectibles': 'Antigüedades y coleccionismo',
  architecture: 'Arquitectura',
  art: 'Arte',
  bibles: 'Biblias',
  'biography & autobiography': 'Biografía y autobiografía',
  'body, mind & spirit': 'Cuerpo, mente y espíritu',
  'business & economics': 'Economía y empresa',
  'comics & graphic novels': 'Cómics y novela gráfica',
  computers: 'Informática',
  cooking: 'Cocina',
  'crafts & hobbies': 'Manualidades y aficiones',
  design: 'Diseño',
  drama: 'Teatro',
  education: 'Educación',
  'family & relationships': 'Familia y relaciones',
  fiction: 'Ficción',
  'foreign language study': 'Estudio de idiomas',
  'games & activities': 'Juegos y actividades',
  gardening: 'Jardinería',
  'health & fitness': 'Salud y bienestar',
  history: 'Historia',
  'house & home': 'Hogar',
  humor: 'Humor',
  'juvenile fiction': 'Ficción infantil y juvenil',
  'juvenile nonfiction': 'No ficción infantil y juvenil',
  'language arts & disciplines': 'Lengua y lingüística',
  law: 'Derecho',
  'literary collections': 'Antologías',
  'literary criticism': 'Crítica literaria',
  mathematics: 'Matemáticas',
  medical: 'Medicina',
  music: 'Música',
  nature: 'Naturaleza',
  'performing arts': 'Artes escénicas',
  pets: 'Mascotas',
  philosophy: 'Filosofía',
  photography: 'Fotografía',
  poetry: 'Poesía',
  'political science': 'Ciencia política',
  psychology: 'Psicología',
  reference: 'Obras de consulta',
  religion: 'Religión',
  science: 'Ciencia',
  'self-help': 'Autoayuda',
  'social science': 'Ciencias sociales',
  'sports & recreation': 'Deportes y ocio',
  'study aids': 'Material de estudio',
  'technology & engineering': 'Tecnología e ingeniería',
  transportation: 'Transporte',
  travel: 'Viajes',
  'true crime': 'Crímenes reales',
  'young adult fiction': 'Ficción juvenil',
  'young adult nonfiction': 'No ficción juvenil',
  general: 'General',

  // Genres and forms
  nonfiction: 'No ficción',
  'non-fiction': 'No ficción',
  'science fiction': 'Ciencia ficción',
  fantasy: 'Fantasía',
  'fantasy fiction': 'Fantasía',
  mystery: 'Misterio',
  'mystery fiction': 'Misterio',
  'detective and mystery stories': 'Novela policíaca',
  'crime fiction': 'Novela negra',
  crime: 'Crimen',
  thriller: 'Thriller',
  thrillers: 'Thriller',
  suspense: 'Suspense',
  romance: 'Romántica',
  'love stories': 'Novela romántica',
  horror: 'Terror',
  'horror tales': 'Terror',
  'historical fiction': 'Novela histórica',
  'action & adventure': 'Acción y aventuras',
  adventure: 'Aventuras',
  'adventure stories': 'Aventuras',
  classics: 'Clásicos',
  'literary fiction': 'Ficción literaria',
  literary: 'Literaria',
  literature: 'Literatura',
  novel: 'Novela',
  novels: 'Novela',
  'short stories': 'Relatos',
  essays: 'Ensayos',
  essay: 'Ensayo',
  biography: 'Biografía',
  biographies: 'Biografías',
  autobiography: 'Autobiografía',
  memoir: 'Memorias',
  memoirs: 'Memorias',
  'personal memoirs': 'Memorias',
  diaries: 'Diarios',
  letters: 'Cartas',
  'children’s literature': 'Literatura infantil',
  "children's literature": 'Literatura infantil',
  "children's fiction": 'Ficción infantil',
  'graphic novels': 'Novela gráfica',
  comics: 'Cómics',
  dystopias: 'Distopías',
  'dystopian fiction': 'Distopía',

  // Literatures
  'spanish literature': 'Literatura española',
  'spanish fiction': 'Ficción española',
  'english literature': 'Literatura inglesa',
  'english fiction': 'Ficción inglesa',
  'american literature': 'Literatura estadounidense',
  'american fiction': 'Ficción estadounidense',
  'french literature': 'Literatura francesa',
  'french fiction': 'Ficción francesa',
  'german literature': 'Literatura alemana',
  'russian literature': 'Literatura rusa',
  'latin american literature': 'Literatura latinoamericana',
  'latin american fiction': 'Ficción latinoamericana',

  // Philosophy, religion and thought
  'philosophy, modern': 'Filosofía moderna',
  'philosophy, ancient': 'Filosofía antigua',
  'political philosophy': 'Filosofía política',
  ethics: 'Ética',
  metaphysics: 'Metafísica',
  logic: 'Lógica',
  epistemology: 'Epistemología',
  existentialism: 'Existencialismo',
  aesthetics: 'Estética',
  theology: 'Teología',
  christianity: 'Cristianismo',
  'catholic church': 'Iglesia católica',
  buddhism: 'Budismo',
  spirituality: 'Espiritualidad',
  mythology: 'Mitología',
  marxism: 'Marxismo',
  capitalism: 'Capitalismo',
  socialism: 'Socialismo',
  democracy: 'Democracia',
  politics: 'Política',
  'politics and government': 'Política y gobierno',
  death: 'Muerte',
  happiness: 'Felicidad',
  love: 'Amor',

  // Society
  women: 'Mujeres',
  feminism: 'Feminismo',
  'feminist theory': 'Teoría feminista',
  sex: 'Sexo',
  'sex role': 'Roles de género',
  'sexual behavior': 'Conducta sexual',
  gender: 'Género',
  'gender studies': 'Estudios de género',
  sociology: 'Sociología',
  anthropology: 'Antropología',
  'social sciences': 'Ciencias sociales',
  economics: 'Economía',
  economy: 'Economía',
  war: 'Guerra',
  'world war, 1939-1945': 'Segunda Guerra Mundial, 1939-1945',
  'world war, 1914-1918': 'Primera Guerra Mundial, 1914-1918',
  'civil war': 'Guerra civil',
  spain: 'España',
  europe: 'Europa',
  culture: 'Cultura',
  family: 'Familia',

  // Science
  physics: 'Física',
  chemistry: 'Química',
  biology: 'Biología',
  astronomy: 'Astronomía',
  evolution: 'Evolución',
  neuroscience: 'Neurociencia',
  medicine: 'Medicina',
  'computer science': 'Informática',
  'computer programming': 'Programación',
  programming: 'Programación',
  'software engineering': 'Ingeniería del software',
  probability: 'Probabilidad',
  statistics: 'Estadística',
  risk: 'Riesgo',
  uncertainty: 'Incertidumbre',
  'decision making': 'Toma de decisiones',

  // Business and self-help
  management: 'Gestión',
  leadership: 'Liderazgo',
  finance: 'Finanzas',
  'personal finance': 'Finanzas personales',
  investing: 'Inversión',
  investments: 'Inversiones',
  'self-actualization (psychology)': 'Autorrealización (psicología)',
  success: 'Éxito',
};

/** Lower case, single spaces, plain apostrophes: the dictionary's key form. */
function key(s: string): string {
  return s.trim().replace(/\s+/g, ' ').replace(/’/g, "'").toLowerCase();
}

function translateOne(subject: string, dict: Record<string, string>): string {
  const whole = dict[key(subject)];
  if (whole) return whole;
  if (!subject.includes('/')) return subject;
  // "Fiction / Science Fiction / General": translate each part, keep the ones it does not know.
  const parts = subject.split('/').map((p) => p.trim());
  const out = parts.map((p) => dict[key(p)] ?? p);
  return out.some((p, i) => p !== parts[i]) ? out.join(' / ') : subject;
}

/**
 * Translates subjects into the client's language when there is a dictionary for it (Spanish today);
 * unknown subjects are kept. Duplicates that the translation creates are dropped, keeping the first.
 */
export function translateSubjects(subjects: string[], lang: Lang): string[] {
  if (lang !== 'es') return subjects;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of subjects) {
    const t = translateOne(s, ES);
    const k = key(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}
