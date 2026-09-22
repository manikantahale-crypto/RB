/**
 * THE VERBS THAT CHANGE WHAT IS RUNNING.
 *
 * Everyone signed in can author: make a workflow, edit one, compile it, test a
 * node, fire a test run, and ask for it to go live. That is the whole point of
 * the tool, and none of it touches production — a draft cannot run, because the
 * ingress router routes by active binding and a draft has none.
 *
 * What an operator cannot do is make something live, or bless somebody else's
 * request to. Those are the verbs below.
 *
 * WHY A LIST IN ONE FILE RATHER THAN A GUARD ON EACH ROUTE. A permission model
 * spread across thirteen route files cannot be read, so it cannot be reviewed —
 * you find out what the rule is by grepping, and you find out it is wrong from
 * a person who could do something they should not. Here the whole policy fits
 * on a screen, `admin-only.test.ts` asserts every releasing verb is covered,
 * and adding a route that changes what runs means adding a line.
 *
 * THE COST OF THIS SHAPE, NAMED. A new releasing route that nobody adds here is
 * open to operators, because the default is allow. That is deliberate: the
 * alternative — default deny, allow-list everything — means every new read
 * endpoint is a 403 until someone notices, and a tool that breaks quietly on
 * every addition gets its guard removed. The test is what closes the gap.
 *
 * THIS IS THE BOUNDARY. The UI also hides these controls, but hiding is for
 * clarity, never for safety: the button is gone, the endpoint still refuses.
 */

export type AdminOnlyRoute = {
  /** Upper case. `*` matches any method. */
  method: string;
  /** Route path as registered; a `:param` segment matches any one segment. */
  path: string;
  /** Why an operator may not, in the words the refusal uses. */
  why: string;
};

export const ADMIN_ONLY: readonly AdminOnlyRoute[] = [
  /* ── workflows ────────────────────────────────────────────────────────── */
  {
    method: "POST",
    path: "/workflows/:graphKey/approve-go-live",
    why: "approving a go-live",
  },
  {
    method: "POST",
    path: "/workflows/:graphKey/take-offline",
    why: "taking a workflow offline",
  },
  {
    method: "POST",
    path: "/workflows/:graphKey/rollback",
    why: "rolling a workflow back to an earlier version",
  },

  /* ── agents (the policy path to the same three acts) ──────────────────── */
  {
    method: "POST",
    path: "/agents/:id/approve-go-live",
    why: "approving a go-live",
  },
  { method: "POST", path: "/agents/:id/activate", why: "making an agent live" },
  { method: "POST", path: "/agents/:id/go-live", why: "making an agent live" },
  {
    method: "POST",
    path: "/agents/:id/take-offline",
    why: "taking an agent offline",
  },
  {
    method: "POST",
    path: "/agents/:id/rollback",
    why: "rolling an agent back to an earlier version",
  },

  /* ── plans ────────────────────────────────────────────────────────────── */
  { method: "POST", path: "/plans/:id/approve", why: "approving a plan" },
  {
    method: "POST",
    path: "/plans/:id/steps/:seq/approve",
    why: "approving a step of a plan",
  },
  { method: "POST", path: "/plans/:id/release", why: "releasing a plan" },

  /* ── runtime ──────────────────────────────────────────────────────────── */
  {
    /**
     * Not a release, but it reaches into a run that is already going and makes
     * a parked one continue — an override of a decision the workflow was
     * waiting on. The ordinary path for that answer is the person replying to
     * RELAY, not this.
     */
    method: "POST",
    path: "/runtime/threads/resume",
    why: "resuming a parked run by hand",
  },
];

/** `/workflows/relay.intake/approve-go-live` against `/workflows/:graphKey/…`. */
function pathMatches(pattern: string, url: string): boolean {
  const p = pattern.split("/").filter(Boolean);
  const u = url.split("/").filter(Boolean);
  if (p.length !== u.length) return false;
  return p.every((seg, i) => seg.startsWith(":") || seg === u[i]);
}

/** The entry that covers this request, or null when an operator may do it. */
export function adminOnlyRoute(
  method: string,
  url: string,
): AdminOnlyRoute | null {
  // Query strings are not part of the route.
  const path = (url.split("?")[0] ?? "").trim();
  const verb = method.toUpperCase();
  return (
    ADMIN_ONLY.find(
      (r) =>
        (r.method === "*" || r.method === verb) && pathMatches(r.path, path),
    ) ?? null
  );
}
