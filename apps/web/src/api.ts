import type {
  AuthMethods,
  CeremonyOptions,
  PasskeyList,
  PasskeyRegistered,
  RecoveryCodes,
  AssetDTO,
  BackupStatus,
  ImportReport,
  BookCreate,
  ChangePasswordRequest,
  CopyCreate,
  CopyPatch,
  DeviceList,
  EditionPatch,
  HealthResponse,
  LibraryFacets,
  LibraryPage,
  LibraryQuery,
  LocationCreate,
  LocationPatch,
  LocationTree,
  LoginRequest,
  LookupResult,
  Problem,
  QuoteCreate,
  QuotePatch,
  ReadingCreate,
  ReadingPatch,
  SessionInfo,
  StatsDTO,
  WishCreate,
  WishDTO,
  WishList,
  WishPatch,
  WorkDetail,
  WorkPatch,
} from '@openlibrary/contracts/client';
import { API_PREFIX, type Lang, type Params } from '@openlibrary/contracts/client';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: Partial<Problem> & Record<string, unknown>,
  ) {
    super(problem.detail ?? problem.title ?? `Error ${status}`);
  }
}

/** UI language, sent as Accept-Language so server messages come back in the same language. */
let apiLang: Lang = 'en';
export const setApiLang = (l: Lang) => {
  apiLang = l;
};

/** `keepalive`: the browser finishes the request even if the page is being left (deferred deletes). */
type RequestOptions = { contentType?: string; keepalive?: boolean };

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const { contentType, keepalive } = opts;
  const isRaw = body instanceof Blob;
  const res = await fetch(API_PREFIX + path, {
    method,
    credentials: 'same-origin',
    keepalive,
    headers: {
      'accept-language': apiLang,
      ...(body === undefined
        ? {}
        : { 'content-type': isRaw ? contentType || 'application/octet-stream' : 'application/json' }),
    },
    body: body === undefined ? undefined : isRaw ? body : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

const qs = (o: Record<string, unknown>) =>
  new URLSearchParams(
    Object.entries(o)
      .filter(([, v]) => v !== undefined && v !== '' && v !== null)
      .map(([k, v]) => [k, String(v)]),
  ).toString();

type Created<T> = WorkDetail & { created: T };

export const api = {
  // system and session
  health: () => request<HealthResponse>('GET', '/health'),
  me: () => request<SessionInfo>('GET', '/auth/me'),
  login: (b: LoginRequest) => request<SessionInfo>('POST', '/auth/login', b),
  logout: () => request<void>('POST', '/auth/logout'),
  devices: () => request<DeviceList>('GET', '/auth/devices'),
  revoke: (id: string) => request<void>('DELETE', `/auth/devices/${encodeURIComponent(id)}`),
  changePassword: (b: ChangePasswordRequest) => request<void>('POST', '/auth/password', b),

  // passkeys
  authMethods: () => request<AuthMethods>('GET', '/auth/methods'),
  passkeyLoginOptions: () => request<CeremonyOptions>('POST', '/auth/login/passkey/options', {}),
  passkeyLogin: (ceremonyId: string, response: Record<string, unknown>) =>
    request<SessionInfo>('POST', '/auth/login/passkey/verify', { ceremonyId, response }),
  passkeys: () => request<PasskeyList>('GET', '/auth/passkeys'),
  passkeyRegisterOptions: (password: string) =>
    request<CeremonyOptions>('POST', '/auth/passkeys/options', { password }),
  passkeyRegister: (ceremonyId: string, response: Record<string, unknown>, name: string) =>
    request<PasskeyRegistered>('POST', '/auth/passkeys/verify', { ceremonyId, response, name }),
  renamePasskey: (id: string, name: string) =>
    request<void>('PATCH', `/auth/passkeys/${encodeURIComponent(id)}`, { name }),
  removePasskey: (id: string, password: string) =>
    request<void>('DELETE', `/auth/passkeys/${encodeURIComponent(id)}`, { password }),
  regenerateCodes: (password: string) => request<RecoveryCodes>('POST', '/auth/recovery-codes', { password }),

  // catalog
  library: (q: LibraryQuery) => request<LibraryPage>('GET', `/library?${qs(q)}`),
  facets: () => request<LibraryFacets>('GET', '/library/facets'),
  work: (id: string) => request<WorkDetail>('GET', `/works/${id}`),
  setFavorite: (id: string, favorite: boolean) =>
    request<WorkDetail>(favorite ? 'POST' : 'DELETE', `/works/${id}/favorite`),
  createBook: (b: BookCreate) => request<Created<{ editionId: string; copyId: string }>>('POST', '/books', b),
  patchWork: (id: string, p: WorkPatch) => request<WorkDetail>('PATCH', `/works/${id}`, p),
  patchEdition: (id: string, p: EditionPatch) => request<WorkDetail>('PATCH', `/editions/${id}`, p),
  deleteEdition: (id: string) => request<{ workDeleted: boolean }>('DELETE', `/editions/${id}`),
  createCopy: (b: CopyCreate) => request<Created<{ copyId: string }>>('POST', '/copies', b),
  patchCopy: (id: string, p: CopyPatch) => request<WorkDetail>('PATCH', `/copies/${id}`, p),
  createReading: (b: ReadingCreate) => request<WorkDetail>('POST', '/reading-sessions', b),
  patchReading: (id: string, p: ReadingPatch) => request<WorkDetail>('PATCH', `/reading-sessions/${id}`, p),
  createQuote: (b: QuoteCreate) => request<WorkDetail>('POST', '/quotes', b),
  patchQuote: (id: string, p: QuotePatch) => request<WorkDetail>('PATCH', `/quotes/${id}`, p),
  deleteQuote: (id: string, opts?: RequestOptions) =>
    request<WorkDetail>('DELETE', `/quotes/${id}`, undefined, opts),
  wishlist: () => request<WishList>('GET', '/wishlist'),
  stats: () => request<StatsDTO>('GET', '/stats'),
  createWish: (b: WishCreate) => request<WishDTO>('POST', '/wishlist', b),
  patchWish: (id: string, p: WishPatch) => request<WishDTO>('PATCH', `/wishlist/${id}`, p),
  deleteWish: (id: string, opts?: RequestOptions) =>
    request<void>('DELETE', `/wishlist/${id}`, undefined, opts),

  // locations
  locations: () => request<LocationTree>('GET', '/locations'),
  createLocation: (b: LocationCreate) => request<LocationTree>('POST', '/locations', b),
  patchLocation: (id: string, p: LocationPatch) => request<LocationTree>('PATCH', `/locations/${id}`, p),
  deleteLocation: (id: string) => request<LocationTree>('DELETE', `/locations/${id}`),

  // metadata and covers
  lookup: (isbn: string) => request<LookupResult>('GET', `/lookup/isbn/${encodeURIComponent(isbn)}`),
  uploadCover: (file: Blob) => request<AssetDTO>('POST', '/assets', file, { contentType: file.type }),
  fetchCover: (url: string) => request<AssetDTO>('POST', '/assets/fetch', { url }),

  // import, export and backups (downloads are plain links to /export/*)
  importFile: (file: Blob, dryRun: boolean) =>
    request<ImportReport>('POST', `/import?dryRun=${dryRun}`, file, { contentType: file.type }),
  backupStatus: () => request<BackupStatus>('GET', '/backups/status'),
};

export const coverUrl = (id: string, size: 'thumb' | 'full' = 'thumb') =>
  `${API_PREFIX}/assets/${id}${size === 'full' ? '?size=full' : ''}`;

/**
 * Readable message for the user. Server errors already come translated (Accept-Language);
 * client-side cases (network down, rate limit wait) use the translator passed in.
 */
export function errorText(e: unknown, t: (key: string, params?: Params) => string): string {
  if (e instanceof ApiError) {
    if (e.status === 429 && typeof e.problem.retryAfterSeconds === 'number') {
      const s = e.problem.retryAfterSeconds;
      return s >= 60
        ? t('errors.retryInMinutes', { n: Math.ceil(s / 60) })
        : t('errors.retryInSeconds', { n: s });
    }
    return e.message;
  }
  return t('errors.network');
}
