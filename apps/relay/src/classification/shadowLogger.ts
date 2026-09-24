import { query } from '../db';
import { v4 as uuidv4 } from 'uuid';

export interface ShadowLogPayload {
  messageId: string;
  ruleIntent: string;
  mlIntent: string;
  mlConfidence: string;
  llmIntent?: string;
}

/**
 * Logs the predictions of the Rule, ML, and LLM classifiers to the database
 * asynchronously. This runs in "shadow mode" without blocking the main flow.
 */
export async function logShadowClassification(payload: ShadowLogPayload) {
  try {
    await query(
      `INSERT INTO relay.ml_shadow_logs (id, message_id, rule_intent, ml_intent, ml_confidence, llm_intent, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        uuidv4(),
        payload.messageId || uuidv4(),
        payload.ruleIntent,
        payload.mlIntent,
        payload.mlConfidence,
        payload.llmIntent || null,
        new Date(),
      ]
    );
    console.log(`[Shadow Log] ML: ${payload.mlIntent} (${payload.mlConfidence}), Rule: ${payload.ruleIntent}, LLM: ${payload.llmIntent || 'N/A'}`);
  } catch (error) {
    console.error('Failed to insert shadow log:', error);
  }
}
