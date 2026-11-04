import type {
  ChangePasswordRequest,
  DeviceList,
  HealthResponse,
  LoginRequest,
  Problem,
  SessionInfo,
} from '@openlibrary/contracts';
import { API_PREFIX } from '@openlibrary/contracts';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: Partial<Problem>,
  ) {
    super(problem.detail ?? problem.title ?? `Error ${status}`);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_PREFIX + path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export const api = {
  health: () => request<HealthResponse>('GET', '/health'),
  me: () => request<SessionInfo>('GET', '/auth/me'),
  login: (b: LoginRequest) => request<SessionInfo>('POST', '/auth/login', b),
  logout: () => request<void>('POST', '/auth/logout'),
  devices: () => request<DeviceList>('GET', '/auth/devices'),
  revoke: (id: string) => request<void>('DELETE', `/auth/devices/${encodeURIComponent(id)}`),
  changePassword: (b: ChangePasswordRequest) => request<void>('POST', '/auth/password', b),
};
