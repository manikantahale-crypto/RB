const API_BASE_URL = 'http://localhost:4000';
const TOKEN_KEY = 'syntra_auth_token';

/**
 * Lightweight wrapper around native fetch that automatically attaches
 * Authorization: Bearer <token> from localStorage to outgoing requests.
 * 
 * Works seamlessly with both JSON requests and FormData uploads.
 */
export async function apiFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  let url: string;
  if (typeof input === 'string') {
    if (input.startsWith('http://') || input.startsWith('https://')) {
      url = input;
    } else {
      url = `${API_BASE_URL}${input.startsWith('/') ? '' : '/'}${input}`;
    }
  } else if (input instanceof URL) {
    url = input.toString();
  } else {
    url = input.url;
  }

  const token = localStorage.getItem(TOKEN_KEY);
  const headers = new Headers(init?.headers);

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (typeof init?.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(url, {
    ...init,
    headers,
  });
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
      const res = await apiFetch(input, init);
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
