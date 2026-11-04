import type {
  AssetDTO,
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
  SessionInfo,
  WorkDetail,
  WorkPatch,
} from '@openlibrary/contracts';
import { API_PREFIX } from '@openlibrary/contracts';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: Partial<Problem> & Record<string, unknown>,
  ) {
    super(problem.detail ?? problem.title ?? `Error ${status}`);
  }
}

async function request<T>(method: string, path: string, body?: unknown, contentType?: string): Promise<T> {
  const isRaw = body instanceof Blob;
  const res = await fetch(API_PREFIX + path, {
    method,
    credentials: 'same-origin',
    headers:
      body === undefined
        ? {}
        : { 'content-type': isRaw ? contentType || 'application/octet-stream' : 'application/json' },
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
  // sistema y sesión
  health: () => request<HealthResponse>('GET', '/health'),
  me: () => request<SessionInfo>('GET', '/auth/me'),
  login: (b: LoginRequest) => request<SessionInfo>('POST', '/auth/login', b),
  logout: () => request<void>('POST', '/auth/logout'),
  devices: () => request<DeviceList>('GET', '/auth/devices'),
  revoke: (id: string) => request<void>('DELETE', `/auth/devices/${encodeURIComponent(id)}`),
  changePassword: (b: ChangePasswordRequest) => request<void>('POST', '/auth/password', b),

  // catálogo
  library: (q: LibraryQuery) => request<LibraryPage>('GET', `/library?${qs(q)}`),
  facets: () => request<LibraryFacets>('GET', '/library/facets'),
  work: (id: string) => request<WorkDetail>('GET', `/works/${id}`),
  createBook: (b: BookCreate) => request<Created<{ editionId: string; copyId: string }>>('POST', '/books', b),
  patchWork: (id: string, p: WorkPatch) => request<WorkDetail>('PATCH', `/works/${id}`, p),
  patchEdition: (id: string, p: EditionPatch) => request<WorkDetail>('PATCH', `/editions/${id}`, p),
  deleteEdition: (id: string) => request<{ workDeleted: boolean }>('DELETE', `/editions/${id}`),
  createCopy: (b: CopyCreate) => request<Created<{ copyId: string }>>('POST', '/copies', b),
  patchCopy: (id: string, p: CopyPatch) => request<WorkDetail>('PATCH', `/copies/${id}`, p),

  // ubicaciones
  locations: () => request<LocationTree>('GET', '/locations'),
  createLocation: (b: LocationCreate) => request<LocationTree>('POST', '/locations', b),
  patchLocation: (id: string, p: LocationPatch) => request<LocationTree>('PATCH', `/locations/${id}`, p),
  deleteLocation: (id: string) => request<LocationTree>('DELETE', `/locations/${id}`),

  // metadatos y portadas
  lookup: (isbn: string) => request<LookupResult>('GET', `/lookup/isbn/${encodeURIComponent(isbn)}`),
  uploadCover: (file: Blob) => request<AssetDTO>('POST', '/assets', file, file.type),
  fetchCover: (url: string) => request<AssetDTO>('POST', '/assets/fetch', { url }),
};

export const coverUrl = (id: string, size: 'thumb' | 'full' = 'thumb') =>
  `${API_PREFIX}/assets/${id}${size === 'full' ? '?size=full' : ''}`;

/** Mensaje legible para mostrar al usuario. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429 && typeof e.problem.retryAfterSeconds === 'number') {
      const s = e.problem.retryAfterSeconds;
      return `Demasiados intentos. Vuelve a probar en ${s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`}.`;
    }
    return e.message;
  }
  return 'No se puede contactar con el servidor.';
}
