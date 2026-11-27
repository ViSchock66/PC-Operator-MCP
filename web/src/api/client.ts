export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH';
  body?: unknown;
}

export async function api<T = unknown>(url: string, opts: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body } = opts;
  const headers: Record<string, string> = {};
  const init: RequestInit = { method, headers };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);
  if (res.status === 401) {
    window.location.reload();
    throw new ApiError('Session expired', 401);
  }

  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new ApiError(data.error || `HTTP ${res.status}`, res.status);
  }
  return data as T;
}
