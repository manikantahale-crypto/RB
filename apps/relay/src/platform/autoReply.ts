import { query } from '../db';
import { EmailSenderFactory } from '../connectors/sender';
import { draftReplyFromContext } from '../drafting/replyDrafter';
import { buildToolResult } from './toolEnvelope';
import {
  AUTO_REPLY_INTENTS,
  MANUAL_ACTION_INTENTS,
  publishPlatformEvent,
} from './platformBridge';
import { relayThreadCorrelationId } from './relayIds';
import { isMarketingOrPortalEmail } from '../classification/staffingSignals';
import {
  evaluateAutoReplyPolicy,
  mergeAutoReplyContext,
  type WorkflowContext,
} from './conversationGuard';

function autoReplyEnabled(): boolean {
  return process.env.RELAY_AUTO_REPLY === '1' || process.env.RELAY_AUTO_REPLY === 'true';
}

/** Document / compliance asks — draft only; recruiter must confirm in UI. */
function looksLikeDocumentRequest(body: string, subject: string): boolean {
  const text = `${subject}\n${body}`.toLowerCase();
  return /\b(rtr|right to represent|passport|i-?9|w-?9|ssn|background check|drug test|onboarding doc|submit.*document|upload.*doc)\b/.test(
    text,
  );
}

export async function tryAutonomousReply(args: {
  threadId: string;
  messageId: string;
  replyIntent: string;
  subject: string;
  body: string;
  fromName: string;
  fromEmail: string;
  toEmail?: string;
  candidate?: { name?: string; skills?: string; visaStatus?: string; rate?: string } | null;
  inReplyTo?: string;
  threadHistory?: string;
  workflowContext?: WorkflowContext;
  priorMessages?: Array<{ direction?: string | null; date?: Date | null }>;
}): Promise<{ sent: boolean; reason: string }> {
  if (!autoReplyEnabled()) {
    return { sent: false, reason: 'RELAY_AUTO_REPLY disabled' };
  }

  if (!AUTO_REPLY_INTENTS.has(args.replyIntent)) {
    return { sent: false, reason: `intent ${args.replyIntent} not auto-reply eligible` };
  }

  if (MANUAL_ACTION_INTENTS.has(args.replyIntent)) {
    return { sent: false, reason: 'manual action intent' };
  }

  const policy = evaluateAutoReplyPolicy({
    messageId: args.messageId,
    replyIntent: args.replyIntent,
    priorMessages: args.priorMessages || [],
    workflowContext: args.workflowContext || {},
  });
  if (!policy.allow) {
    return { sent: false, reason: policy.reason };
  }

  if (looksLikeDocumentRequest(args.body, args.subject)) {
    return { sent: false, reason: 'document submission — action needed, not auto-sent' };
  }

  const recipient = args.fromEmail;
  if (!recipient || isMarketingOrPortalEmail(recipient, args.subject, args.body, args.fromName)) {
    return { sent: false, reason: 'non-replyable recipient' };
  }

  const draft = await draftReplyFromContext({
    subject: args.subject,
    body: args.body,
    fromName: args.fromName,
    fromEmail: args.fromEmail,
    replyIntent: args.replyIntent,
    requiresFollowup: true,
    priority: 'High',
    candidate: args.replyIntent === 'Requirement Shared' ? null : args.candidate,
    threadHistory: args.threadHistory,
  });

  if (!draft.replyable) {
    return { sent: false, reason: 'draft marked non-replyable' };
  }

  const sender = EmailSenderFactory.getSender();
  const ok = await sender.sendEmail(
    recipient,
    draft.subject.startsWith('Re:') ? draft.subject : `RE: ${args.subject}`,
    draft.body,
    args.inReplyTo,
  );

  if (ok) {
    const nextCtx = mergeAutoReplyContext(args.workflowContext || {}, args.messageId, args.replyIntent);
    await query(
      `UPDATE relay.email_threads SET workflow_context = $1 WHERE thread_id = $2`,
      [JSON.stringify(nextCtx), args.threadId]
    );

    await query(
      `UPDATE relay.followups SET status = 'Closed' WHERE thread_id = $1`,
      [args.threadId]
    );

    const toolResult = buildToolResult(
      'relay.auto_reply.send',
      'relay.email.classified',
      'ok',
      {
        body: draft.body,
        email: recipient,
        thread_id: args.threadId,
        message_id: args.messageId,
        reply_intent: args.replyIntent,
        source: draft.source,
      },
      'relay.auto_reply.completed',
    );

    const orchCorrelationId = relayThreadCorrelationId(args.threadId);

    await publishPlatformEvent({
      eventType: 'relay.auto_reply.completed',
      aggregateType: 'email_thread',
      aggregateId: orchCorrelationId,
      correlationId: orchCorrelationId,
      payload: {
        thread_id: args.threadId,
        relay_thread_id: args.threadId,
        message_id: args.messageId,
        reply_intent: args.replyIntent,
        tool_result: toolResult,
      },
    });
  }

  return { sent: ok, reason: ok ? 'auto-reply sent' : 'send failed' };
}
