/** Guards against auto-reply ping-pong and duplicate sends on the same thread. */

export type ThreadMessageSnapshot = {
  direction?: string | null;
  date?: Date | null;
};

export type WorkflowContext = Record<string, unknown> & {
  auto_reply_message_ids?: string[];
  auto_reply_count?: number;
  last_auto_reply_at?: string;
  last_auto_reply_intent?: string;
  shortlist_status?: string;
};

const PING_PONG_INTENTS = new Set(['Vendor Reply', 'Follow-up']);
const MAX_AUTO_REPLIES_PER_THREAD = 2;
const MIN_HOURS_BETWEEN_CHASE = 6;

export function evaluateAutoReplyPolicy(args: {
  messageId: string;
  replyIntent: string;
  priorMessages: ThreadMessageSnapshot[];
  workflowContext: WorkflowContext;
}): { allow: boolean; reason: string } {
  const ctx = args.workflowContext || {};
  const repliedIds = Array.isArray(ctx.auto_reply_message_ids) ? ctx.auto_reply_message_ids : [];

  if (repliedIds.includes(args.messageId)) {
    return { allow: false, reason: 'already auto-replied to this message' };
  }

  const autoReplyCount = Number(ctx.auto_reply_count || 0);
  if (autoReplyCount >= MAX_AUTO_REPLIES_PER_THREAD) {
    return { allow: false, reason: 'max auto-replies reached for this conversation' };
  }

  if (args.replyIntent === 'Requirement Shared' && autoReplyCount >= 1) {
    return { allow: false, reason: 'JD already acknowledged — awaiting match results' };
  }

  const sentCount = args.priorMessages.filter((m) => m.direction === 'sent').length;
  if (PING_PONG_INTENTS.has(args.replyIntent) && sentCount >= 2) {
    return { allow: false, reason: 'conversation already has outbound replies — no chase' };
  }

  const lastAt = ctx.last_auto_reply_at;
  if (lastAt && PING_PONG_INTENTS.has(args.replyIntent)) {
    const hours = (Date.now() - new Date(lastAt).getTime()) / 3_600_000;
    if (hours < MIN_HOURS_BETWEEN_CHASE) {
      return { allow: false, reason: 'recent auto-reply — waiting for their response' };
    }
  }

  return { allow: true, reason: 'ok' };
}

export function buildConversationSummary(
  messages: Array<{ direction?: string | null; fromName?: string | null; fromEmail?: string | null; cleanedBody?: string | null; rawBody?: string | null }>,
  limit = 10,
): string {
  return messages
    .slice(-limit)
    .map((m) => {
      const who =
        m.direction === 'sent' ? 'You (recruiter)' : m.fromName || m.fromEmail || 'Sender';
      const text = (m.cleanedBody || m.rawBody || '').slice(0, 500);
      return `${who}: ${text}`;
    })
    .join('\n---\n');
}

export function mergeAutoReplyContext(
  ctx: WorkflowContext,
  messageId: string,
  replyIntent: string,
): WorkflowContext {
  const ids = Array.isArray(ctx.auto_reply_message_ids) ? [...ctx.auto_reply_message_ids] : [];
  if (!ids.includes(messageId)) ids.push(messageId);
  return {
    ...ctx,
    auto_reply_message_ids: ids.slice(-50),
    auto_reply_count: Number(ctx.auto_reply_count || 0) + 1,
    last_auto_reply_at: new Date().toISOString(),
    last_auto_reply_intent: replyIntent,
  };
}
