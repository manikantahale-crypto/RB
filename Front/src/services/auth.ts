import { AuthResponse, User } from '../types';
import { API_BASE_URL } from '../config';

async function parseResponse<T>(res: Response): Promise<T> {
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    const errorMsg = data?.error || data?.detail || `Request failed with status ${res.status}`;
    throw new Error(errorMsg);
  }

  return data as T;
}

export async function signup(fullName: string, email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE_URL}/auth/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fullName, email, password }),
  });

  return parseResponse<AuthResponse>(res);
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  return parseResponse<AuthResponse>(res);
}

export async function getMe(token: string): Promise<{ user: User }> {
  const res = await fetch(`${API_BASE_URL}/auth/me`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  return parseResponse<{ user: User }>(res);
}
