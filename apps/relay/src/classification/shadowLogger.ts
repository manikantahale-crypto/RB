import { db } from '../db';
import { mlShadowLogs } from '../db/schema';
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
    await db.insert(mlShadowLogs).values({
      id: uuidv4(),
      messageId: payload.messageId || uuidv4(), // Fallback if messageId is missing during testing
      ruleIntent: payload.ruleIntent,
      mlIntent: payload.mlIntent,
      mlConfidence: payload.mlConfidence,
      llmIntent: payload.llmIntent || null,
      timestamp: new Date()
    });
    console.log(`[Shadow Log] ML: ${payload.mlIntent} (${payload.mlConfidence}), Rule: ${payload.ruleIntent}, LLM: ${payload.llmIntent || 'N/A'}`);
  } catch (error) {
    console.error('Failed to insert shadow log:', error);
  }
}
