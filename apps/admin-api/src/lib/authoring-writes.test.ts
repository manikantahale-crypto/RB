/**
 * Withdrawing a go-live request leaves nothing of the request behind.
 *
 * V20260909.62 says a note needs a request (`request_note IS NULL OR
 * requested_at IS NOT NULL`). The withdraw UPDATE cleared `requested_at` and
 * left `request_note`, so every withdrawal of a request that carried a note
 * failed on the constraint — AUTH-002 in the 2026-09-19 testing report.
 * Pinned by the statement's shape.
 */
import { describe, expect, it } from "vitest";
import { cancelGoLiveRequest } from "./authoring-writes.js";

describe("cancelGoLiveRequest", () => {
  it("clears the note with the request, so the CHECK from .62 holds", async () => {
    let text = "";
    const db = {
      query: async (t: string) => {
        text = t;
        return { rows: [{ version: 3 }] };
      },
    } as never;
    const out = await cancelGoLiveRequest(db, { graphKey: "syntra.a.workflow", orgId: null });
    expect(out).toEqual({ version: 3 });
    expect(text).toMatch(/requested_at\s*=\s*NULL/);
    expect(text).toMatch(/request_note\s*=\s*NULL/);
    expect(text).toMatch(/status\s*=\s*'compiled'/);
    expect(text).toMatch(/v\.status = 'pending_go_live'/);
  });
});
