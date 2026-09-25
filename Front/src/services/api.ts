import { API_BASE_URL } from '../config';
const TOKEN_KEY = 'syntra_auth_token';

/**
 * Lightweight wrapper around native fetch that automatically attaches
 * Authorization: Bearer <token> from localStorage to outgoing requests.
 * 
 * Works seamlessly with both JSON requests and FormData uploads.
 */
function isClientDebug(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    (window as any).__DEBUG_MODE__ === true ||
    localStorage.getItem('DEBUG_MODE') === 'true' ||
    import.meta.env.VITE_DEBUG_MODE === 'true'
  );
}

export async function apiFetch(
  input: string | URL | Request,
  init?: RequestInit,
  retryAttempt = 0
): Promise<Response> {
  let url: string;
  let pathOnly: string;
  if (typeof input === 'string') {
    if (input.startsWith('http://') || input.startsWith('https://')) {
      url = input;
      pathOnly = input;
    } else {
      pathOnly = input.startsWith('/') ? input : `/${input}`;
      url = `${API_BASE_URL}${pathOnly}`;
    }
  } else if (input instanceof URL) {
    url = input.toString();
    pathOnly = input.pathname + input.search;
  } else {
    url = input.url;
    pathOnly = input.url;
  }

  const rawToken = typeof window !== 'undefined' ? (localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY)) : null;
  const token = rawToken ? rawToken.trim() : null;
  const headers = new Headers(init?.headers);

  // Preserve or generate request correlation ID
  let requestId = headers.get('X-Request-Id');
  if (!requestId) {
    requestId = `cl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    headers.set('X-Request-Id', requestId);
  }

  const existingAuth = headers.get('Authorization');
  if (token && token !== 'undefined' && token !== 'null' && (!existingAuth || existingAuth === 'undefined' || existingAuth === 'null' || existingAuth.trim() === '')) {
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();
    if (cleanToken && cleanToken !== 'undefined' && cleanToken !== 'null') {
      headers.set('Authorization', `Bearer ${cleanToken}`);
    }
  }

  if (typeof init?.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const method = (init?.method || 'GET').toUpperCase();
  const debug = isClientDebug();
  const startTime = debug ? performance.now() : 0;

  try {
    const res = await fetch(url, {
      ...init,
      headers,
    });

    if (debug || res.status === 401) {
      const duration = Math.round(performance.now() - startTime);
      const retryTag = retryAttempt > 0 ? ` retry=${retryAttempt}` : '';
      const authAttached = headers.has('Authorization');
      console.log(
        `[API DEBUG] ${method} ${pathOnly} status=${res.status} duration=${duration}ms requestId=${requestId} authAttached=${authAttached}${retryTag}`
      );
    }

    return res;
  } catch (err: any) {
    if (debug) {
      const duration = Math.round(performance.now() - startTime);
      console.error(
        `[API DEBUG ERROR] ${method} ${pathOnly} duration=${duration}ms requestId=${requestId} error=${err?.message || err}`
      );
    }
    throw err;
  }
}

/** Long-running requests (e.g. Run Match with sync Tier 3 scoring). */
export async function apiFetchWithTimeout(
  input: string,
  init?: RequestInit,
  timeoutMs = 120000,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await apiFetch(input, { ...init, signal: ctrl.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

/** Retry transient API failures (e.g. Supabase pool exhausted under dev load). */
export async function apiFetchWithRetry(
  input: string | URL | Request,
  init?: RequestInit,
  retries = 3,
): Promise<Response> {
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await apiFetch(input, init, attempt);
      lastResponse = res;
      if (res.ok) return res;
      // Do not retry auth/client errors
      if (res.status >= 400 && res.status < 500) return res;
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt >= retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  return lastResponse!;
}
