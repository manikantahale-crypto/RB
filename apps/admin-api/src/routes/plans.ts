/**
 * Plans — ask, get it approved, release it all at once.
 *
 * The rules live in ../lib/plans.ts and are tested there. These routes do the
 * two things routes should: turn a request into arguments, and turn a verdict
 * into a status code with a sentence a person can act on.
 *
 * `POST /plans/:id/release` is the one that matters. It takes a transaction
 * and holds it across every step, because "all of it or none of it" is the
 * whole reason a plan is a row rather than a screen.
 */

import type { Pool } from "pg";
import { adminIdOf } from "../lib/admin-identity.js";
import {
  approvePlan,
  approvePlanStep,
  canRelease,
  loadPlan,
  releasePlan,
  requestPlanApproval,
} from "../lib/plans.js";

type FastifyLike = {
  get: (path: string, handler: any) => void;
  post: (path: string, handler: any) => void;
};

const readAdminId = (headers: any): string => adminIdOf({ headers });

export function registerPlanRoutes(app: FastifyLike, pool: Pool): void {
  app.get("/plans/:id", async (req: any, reply: any) => {
    try {
      const plan = await loadPlan(pool, String(req.params.id));
      if (!plan) return reply.code(404).send({ error: "plan_not_found" });

      const verdict = canRelease(plan);
      return {
        ...plan,
        // Shown before anybody presses anything, so the reason to wait is
        // visible rather than discovered on refusal.
        releasable: verdict.ok,
        blockedBy: verdict.ok ? null : verdict.reason,
      };
    } catch (err: any) {
      req.log?.error?.(err);
      return reply.code(500).send({ error: "plan_read_failed", message: String(err) });
    }
  });

  app.post("/plans/:id/request-approval", async (req: any, reply: any) => {
    try {
      const asked = await requestPlanApproval(pool, {
        planId: String(req.params.id),
        by: readAdminId(req.headers),
      });
      if (!asked) {
        return reply.code(409).send({
          error: "not_a_draft",
          message:
            "Only a draft plan can be sent for approval. This one has already " +
            "been sent, released, or abandoned.",
        });
      }
      return {
        planId: String(req.params.id),
        status: "pending_approval",
        note: "Nothing runs differently yet. Somebody else has to approve it.",
      };
    } catch (err: any) {
      req.log?.error?.(err);
      return reply.code(500).send({ error: "request_failed", message: String(err) });
    }
  });

  app.post("/plans/:id/approve", async (req: any, reply: any) => {
    try {
      const result = await approvePlan(pool, {
        planId: String(req.params.id),
        by: readAdminId(req.headers),
      });
      if (!result.ok) {
        return reply
          .code(result.status)
          .send({ error: result.error, message: result.message });
      }

      // Approval is not release. Say what is still outstanding, because a
      // cross-owner step is the usual answer and is nobody's fault.
      const plan = await loadPlan(pool, String(req.params.id));
      const verdict = plan ? canRelease(plan) : { ok: false, reason: "unknown" };
      return {
        planId: String(req.params.id),
        approved: true,
        releasable: verdict.ok,
        blockedBy: verdict.ok ? null : (verdict as any).reason,
      };
    } catch (err: any) {
      req.log?.error?.(err);
      return reply.code(500).send({ error: "approve_failed", message: String(err) });
    }
  });

  /** One application's owner signing off the step that touches them. */
  app.post("/plans/:id/steps/:seq/approve", async (req: any, reply: any) => {
    try {
      const done = await approvePlanStep(pool, {
        planId: String(req.params.id),
        seq: Number(req.params.seq),
        by: readAdminId(req.headers),
      });
      if (!done) {
        return reply.code(409).send({
          error: "nothing_to_approve",
          message:
            "That step either belongs to the author's own application, or has " +
            "already been approved. Only a step owned by somebody else needs a " +
            "second yes.",
        });
      }
      return { planId: String(req.params.id), seq: Number(req.params.seq), approved: true };
    } catch (err: any) {
      req.log?.error?.(err);
      return reply.code(500).send({ error: "approve_step_failed", message: String(err) });
    }
  });

  app.post("/plans/:id/release", async (req: any, reply: any) => {
    const planId = String(req.params.id);

    const client = await pool.connect();
    try {
      const plan = await loadPlan(client, planId);
      if (!plan) return reply.code(404).send({ error: "plan_not_found" });

      const verdict = canRelease(plan);
      if (!verdict.ok) {
        return reply.code(409).send({ error: "not_releasable", message: verdict.reason });
      }

      /**
       * One transaction across every step.
       *
       * Without it there is a window where a new workflow is live and the
       * upstream trigger has not moved yet, and events in that window go
       * somewhere nobody chose. That window is the reason this table exists.
       */
      await client.query("BEGIN");
      const { released, missing } = await releasePlan(client, { planId });

      if (missing.length > 0) {
        // Roll the whole thing back. Releasing the steps that were ready and
        // leaving the rest is precisely the half-applied chain a plan exists
        // to make impossible.
        await client.query("ROLLBACK");
        return reply.code(409).send({
          error: "nothing_compiled",
          message:
            `${missing.length} of ${verdict.willRelease.length} step(s) have no ` +
            `compiled version to promote: ${missing.join(", ")}. Nothing was ` +
            `released — a plan goes live whole or not at all. Compile those ` +
            `workflows and try again.`,
        });
      }

      await client.query("COMMIT");

      return {
        planId,
        released,
        note: "Every step went live together.",
      };
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      req.log?.error?.(err);
      return reply.code(500).send({ error: "release_failed", message: String(err) });
    } finally {
      client.release();
    }
  });
}
