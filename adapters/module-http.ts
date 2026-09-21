/**
 * The one HTTP call every module adapter makes, made once.
 *
 * Every module's backend is reached the same way — build a request, send it,
 * hand back the response, interpret nothing — so the call is written here and
 * each module (`syntra/syntra-http.ts`, `astra/astra-http.ts`,
 * `orbit/orbit-http.ts`) names its service and its base URL. Today all three
 * are served by one `node-api` process, so the base URLs default to one
 * another; the split is so that stays a deployment choice.
 *
 * When `shared/http-contracts` is populated, the request and response shapes
 * move there and this file imports them instead of typing them loosely.
 */

export type ModuleResponse = Record<string, any>;

/**
 * `force` always fakes, `off` always fails hard, `auto` (the default) fakes
 * once with a warning when the service is UNREACHABLE so local smoke stays
 * green.
 *
 * "Unreachable" means the connection never completed — DNS, refused, reset,
 * timed out. It does NOT mean an error response. See `post`.
 *
 * One switch, `ORCH_STUB_SYNTRA`, for every module node-api serves: they are
 * one process, and a stubbed ASTRA beside a live SYNTRA would answer nothing
 * anyone asked. RELAY is its own process and has its own, `ORCH_STUB_RELAY`.
 *
 * This is a DEV convenience and is not the contract's `stub`. Contract stubs
 * are CI machinery and never run in a real process; this runs in a real
 * process and says so in the log.
 */
function stubMode(stubEnv: string): 'force' | 'auto' | 'off' {
  const v = (process.env[stubEnv] ?? 'auto').toLowerCase();
  if (v === '1' || v === 'true' || v === 'force') return 'force';
  if (v === '0' || v === 'false' || v === 'off') return 'off';
  return 'auto';
}

export type ModulePoster = (
  path: string,
  body?: Record<string, unknown>,
  opts?: { signal?: AbortSignal },
) => Promise<ModuleResponse>;

/**
 * A poster for one module. `service` is the word in the log and the error;
 * `baseUrl` is read on every call so a test can set the environment;
 * `stubEnv` names the dev-stub switch (default: node-api's).
 */
export function modulePoster(
  service: string,
  baseUrl: () => string,
  { stubEnv = 'ORCH_STUB_SYNTRA' }: { stubEnv?: string } = {},
): ModulePoster {
  return async function post(path, body, opts = {}) {
    const mode = stubMode(stubEnv);
    if (mode === 'force') {
      return {
        status: 'stubbed',
        stub: true,
        path,
        body: body ?? null,
        skillMatchScore: 0.82,
      };
    }

    // Only the connection attempt is stubbable. Everything after it is a real
    // answer from the service and must be reported as one.
    //
    // THIS SPLIT IS THE WHOLE POINT. Both halves used to live in one try/catch,
    // so the `!res.ok` throw was caught by the same handler as a refused
    // connection and turned into `{ status: 'stubbed' }` — a 404 or a 500 came
    // back as a SUCCESSFUL stubbed response, the node's output schema accepted
    // it, and the run finished green. Four nodes were calling endpoints that do
    // not exist in node-api at all, and nothing ever said so.
    const base = baseUrl();
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        // The node's time limit, from the runtime. Without it a timed-out node
        // would keep the service working on a request nobody is waiting for.
        signal: opts.signal,
      });
    } catch (err) {
      // The runtime gave up on this node. That is not the service being
      // unreachable and must never be stubbed into a success.
      if (opts.signal?.aborted) throw err;
      // fetch only rejects when the request never got an answer.
      if (mode === 'off') throw err;
      console.warn(
        `[${service}] unreachable (${base}${path}) — stubbing response. ` +
          `Set ${stubEnv}=0 to fail hard. Cause: ${
            err instanceof Error ? err.message : err
          }`,
      );
      return {
        status: 'stubbed',
        stub: true,
        path,
        body: body ?? null,
        skillMatchScore: 0.75,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // The service answered. Whatever it said is the truth, including 404 and
    // 500 — never stubbed over, in any mode. `classifyModuleError` reads the
    // status code out of this exact message, so the format is load-bearing.
    if (!res.ok) {
      throw new Error(`${service} ${path} failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as ModuleResponse;
  };
}

/**
 * Which errors are worth retrying. A network failure or a 5xx is transient; a
 * 4xx means the request was wrong and repeating it will not help.
 *
 * Shared because every module node classifies the same way — if one ever
 * needs to differ, it overrides in its own contract and says why.
 */
export function classifyModuleError(
  e: unknown,
): 'transient' | 'permanent_input' | 'permanent_system' {
  const message = e instanceof Error ? e.message : String(e);
  const status = /failed: (\d{3})/.exec(message)?.[1];
  if (status) {
    const code = Number(status);
    if (code >= 500) return 'transient';
    if (code === 408 || code === 429) return 'transient';
    return 'permanent_input';
  }
  // fetch throws TypeError for DNS/connection failures — the service is down,
  // not the request wrong.
  if (e instanceof TypeError) return 'transient';
  return 'permanent_system';
}
