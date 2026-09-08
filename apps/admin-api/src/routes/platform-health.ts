/**
 * Platform health — the four questions, on a screen.
 *
 * WHY THIS EXISTS: every fault these checks find is one the system cannot
 * report itself. A binding whose queue nobody works, a step in no registry, an
 * event nothing answers — none of them raise an error, because nothing fails.
 * Work simply stops, and the only way anyone found out was by running a query
 * by hand.
 *
 * Read-only. Four SELECTs and no writes: looking at the platform must never be
 * the thing that changes it.
 *
 * The checks are pure (`lib/platform-checks.ts`, unit tested) and the queries
 * are shared with `npm run check:platform` (`lib/platform-facts.ts`), so the
 * screen and the terminal cannot disagree about what they are looking at.
 */
import type { Pool } from "pg";
import { runPlatformChecks, allPassed } from "../lib/platform-checks.js";
import { gatherPlatformFacts } from "../lib/platform-facts.js";

type FastifyLike = {
  get: (path: string, handler: any) => void;
};

export function registerPlatformHealthRoutes(
  app: FastifyLike,
  pool: Pool,
): void {
  app.get("/platform/checks", async (req: any, reply: any) => {
    try {
      /**
       * No `planKindOf` passed on purpose — see `gatherPlatformFacts`. It would
       * mean importing the engine into admin-api and inheriting eleven type
       * errors that are deliberate. The routing-hazards check then reports
       * "not checked" rather than guessing, which is the rule everywhere else
       * in these checks.
       */
      const facts = await gatherPlatformFacts(pool);
      const findings = runPlatformChecks(facts);

      return {
        ok: allPassed(findings),
        checkedAt: new Date().toISOString(),
        counts: {
          bindings: facts.bindings.length,
          activeGraphs: facts.graphs.length,
          registeredNodes: facts.registry.length,
        },
        findings,
      };
    } catch (err: any) {
      req.log?.error?.(err);
      return reply
        .code(500)
        .send({ error: "platform_checks_failed", message: String(err) });
    }
  });
}
