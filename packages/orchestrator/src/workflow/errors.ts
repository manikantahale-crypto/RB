/**
 * Design §10 — tri-class error model for node/job handling.
 *
 * | Class            | Examples                                      | Handling                                      |
 * |------------------|-----------------------------------------------|-----------------------------------------------|
 * | transient        | LLM timeout/429, DB deadlock, network blip    | Throw → pg-boss retry + checkpoint resume     |
 * | permanent-input  | Unparseable input, node precondition failure  | Job succeeds (terminal product state)         |
 * | permanent-system | DEFINITION_INVALID, missing registry key      | Fail job immediately, page on-call            |
 */

export type ErrorClass = 'transient' | 'permanent-input' | 'permanent-system';

export class ClassifiedError extends Error {
  readonly errorClass: ErrorClass;
  readonly nodeId?: string;
  readonly graphKey?: string;
  readonly cause: unknown;

  constructor(
    message: string,
    errorClass: ErrorClass,
    opts: { nodeId?: string; graphKey?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'ClassifiedError';
    this.errorClass = errorClass;
    this.nodeId = opts.nodeId;
    this.graphKey = opts.graphKey;
    this.cause = opts.cause;
  }
}

export function classifyError(err: unknown): ErrorClass {
  if (err instanceof ClassifiedError) return err.errorClass;

  const message = err instanceof Error ? err.message : String(err);
  const statusCode =
    typeof err === 'object' && err !== null && 'statusCode' in err
      ? Number((err as { statusCode?: number }).statusCode)
      : undefined;
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: string }).code)
      : undefined;

  /**
   * A SERVICE BEING DOWN IS NOT A CODE FAULT, AND USED TO BE READ AS ONE.
   *
   * Node's `fetch` rejects with `TypeError: fetch failed` when it cannot open
   * the socket — DNS, connection refused, the process not started. The
   * `instanceof TypeError` rule below was written for `undefined is not a
   * function`, a genuine deployment fault, and predates fetch behaving this
   * way. So every "node-api is not running" landed in the class this file's
   * own table describes as "Fail job immediately, page on-call", and the run
   * was never retried.
   *
   * It belongs in the row above it: "network blip — throw → pg-boss retry +
   * checkpoint resume". Start the service and the same event succeeds.
   *
   * Checked BEFORE the TypeError rule, because it is a narrower case of it.
   * `cause.code` is where undici puts the real reason; the message check
   * catches the shapes that arrive without one.
   */
  const causeCode =
    typeof err === 'object' && err !== null && 'cause' in err
      ? String((err as { cause?: { code?: string } }).cause?.code ?? '')
      : '';
  if (
    /^(ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPIPE|ETIMEDOUT|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT)$/.test(
      causeCode,
    ) ||
    /^(ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPIPE|ETIMEDOUT)$/.test(code ?? '') ||
    /fetch failed|socket hang up|network(?:\s|-)?error|other side closed/i.test(message)
  ) {
    return 'transient';
  }

  // Permanent-system: deployment/CI invariants violated
  if (
    err instanceof TypeError ||
    err instanceof ReferenceError ||
    /DEFINITION_INVALID/i.test(message) ||
    /Node implementation not found/i.test(message) ||
    /state.?schema/i.test(message) ||
    /Invalid graph definition/i.test(message) ||
    /Invalid node in/i.test(message) ||
    /Invalid edge in/i.test(message) ||
    /is not a function/i.test(message) ||
    /Cannot read propert(y|ies) of (undefined|null)/i.test(message)
  ) {
    return 'permanent-system';
  }

  // Permanent-input: bad payload / precondition — not worth retrying
  // (include "no resumeId/jobId in payload" from syntra.* / astra.* nodes — otherwise poison jobs retry forever)
  if (
    /Missing (jobId|resumeId|jobId or resumeId)/i.test(message) ||
    /no (resumeId|jobId) in payload/i.test(message) ||
    /need jobId and resumeId/i.test(message) ||
    /empty raw_text/i.test(message) ||
    /unprocessable JD/i.test(message) ||
    /missing trigger_event/i.test(message) ||
    /unparseable|unprocessable|precondition/i.test(message) ||
    statusCode === 400 ||
    statusCode === 404 ||
    statusCode === 422
  ) {
    return 'permanent-input';
  }

  // Transient: retryable infrastructure / provider blips
  if (
    statusCode === 429 ||
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 504 ||
    /Syntra unreachable/i.test(message) ||
    /timeout|ECONNRESET|ECONNREFUSED|ETIMEDOUT|deadlock|40P01|40001/i.test(message) ||
    code === '40P01' ||
    code === '40001' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED'
  ) {
    return 'transient';
  }

  // Default: treat unknown failures as transient so we don't dead-letter on blips
  return 'transient';
}

export function enrichError(
  err: unknown,
  meta: { nodeId: string; graphKey: string },
): ClassifiedError {
  const errorClass = classifyError(err);
  const baseMessage = err instanceof Error ? err.message : String(err);
  return new ClassifiedError(
    `[${errorClass}] ${meta.graphKey}/${meta.nodeId}: ${baseMessage}`,
    errorClass,
    { nodeId: meta.nodeId, graphKey: meta.graphKey, cause: err },
  );
}
