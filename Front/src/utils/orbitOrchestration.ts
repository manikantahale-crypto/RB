import { apiFetch } from '../services/api';

const POLL_MS = 1500;
const MAX_ATTEMPTS = 40;

/** Poll until async ORBIT orchestration applies (202 Accepted responses). */
export async function pollOrbitLifecycleState(
  candidateId: string,
  expectedState: string,
): Promise<string> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const res = await apiFetch(`/candidates/${candidateId}/lifecycle`);
    if (res.ok) {
      const data = await res.json();
      const current = (data.current_state || '').toUpperCase();
      if (current === expectedState.toUpperCase()) {
        return current;
      }
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(
    `Orchestration did not apply lifecycle state ${expectedState} in time — check worker terminal for [Orch] logs`,
  );
}

/** Poll until a new note appears after orchestration. */
export async function pollOrbitNoteCount(
  candidateId: string,
  previousCount: number,
): Promise<void> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const res = await apiFetch(`/candidates/${candidateId}/activities`);
    if (res.ok) {
      const json = await res.json();
      const notes = (json.data || []).filter(
        (a: { activity_type?: string }) => a.activity_type === 'NOTE',
      );
      if (notes.length > previousCount) {
        return;
      }
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(
    'Orchestration did not save the note in time — check worker terminal for [Orch] logs',
  );
}

export function isOrchestrationAccepted(res: Response): boolean {
  return res.status === 202;
}
