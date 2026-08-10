import type { EventInput } from '../../types.js';

function getApiUrl(): string {
  const url = process.env.SYNTRA_API_URL || 'http://127.0.0.1:4000';
  return url.replace(/\/$/, '');
}

async function safeFetch(url: string, options: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 35000); // 35s timeout

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal as any,
    });

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      const detail = data?.error || data?.detail || text || response.statusText;
      const err = new Error(`HTTP ${response.status}: ${detail}`);
      (err as any).statusCode = response.status;
      throw err;
    }

    return data;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error(`Syntra API Timeout (${url})`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function processJdNode(state: any): Promise<any> {
  const event: EventInput = state.trigger_event;
  const jobId = event.payload?.jobId || event.aggregate_id;
  
  if (!jobId) {
    throw new Error("Missing jobId in trigger_event");
  }

  const url = `${getApiUrl()}/internal/jobs/${jobId}/process`;
  
  const result = await safeFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  return { 
    syntraResult: result 
  };
}

export async function processResumeNode(state: any): Promise<any> {
  const event: EventInput = state.trigger_event;
  const resumeId = event.payload?.resumeId || event.aggregate_id;
  const candidateId = event.payload?.candidateId;

  if (!resumeId) {
    throw new Error("Missing resumeId in trigger_event");
  }

  const url = `${getApiUrl()}/internal/resumes/${resumeId}/process`;
  const body = candidateId ? { candidateId } : {};

  const result = await safeFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
  });

  return {
    syntraResult: result
  };
}

export async function processMatchNode(state: any): Promise<any> {
  const event: EventInput = state.trigger_event;
  const jobId = event.payload?.jobId;
  const resumeId = event.payload?.resumeId;

  if (!jobId || !resumeId) {
    throw new Error("Missing jobId or resumeId in trigger_event");
  }

  const url = `${getApiUrl()}/internal/matches/process`;
  const result = await safeFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, resumeId }),
  });

  return {
    syntraResult: result
  };
}
