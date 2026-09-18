import { classifyEmailMessage } from './ruleClassifier';
import { llmClassifyEmailMessage } from './llmClassifier';
import {
  finalizeClassification,
  isDeterministicRuleResult,
} from './vendor-category';

/** High-value intents that should appear in Priority tab when follow-up is required. */
export const HIGH_PRIORITY_INTENTS = [
  'Interview Request',
  'Selected for Interview',
  'Candidate Shortlisted',
  'Need Resume',
  'Rate Asked',
  'Requirement Shared',
  'Client Submission',
  'Follow-up',
  'Follow-Up Needed',
] as const;

/**
 * LLM-first pipeline (ML deferred).
 *
 * 1. Rules — deterministic only: bounce, portal, sent.
 * 2. LLM — all other received mail when RELAY_LLM_CLASSIFY=1 (intent + follow-up).
 * 3. Vendor registry — category lock applied after classify (Vendor Reply bucket).
 * 4. On LLM failure — rule result + vendor lock.
 */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

export interface ClassifyOutcome {
  classification: Record<string, unknown>;
  escalatedToLlm: boolean;
  llmError?: string;
}

function llmEnabled(): boolean {
  return process.env.RELAY_LLM_CLASSIFY === '1' || process.env.RELAY_LLM_CLASSIFY === 'true';
}

function preserveVendorFromRules(
  ruleClassification: Record<string, unknown>,
  result: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...result,
    vendorMatch: ruleClassification.vendorMatch,
    vendor: ruleClassification.vendor,
    senderType: ruleClassification.vendorMatch ? 'vendor' : result.senderType,
  };
}

export async function classify(
  emailData: Record<string, unknown>,
  vendorsMap: Map<string, unknown> | null,
): Promise<Record<string, unknown>> {
  const outcome = await classifyWithMeta(emailData, vendorsMap);
  return outcome.classification;
}

export async function classifyWithMeta(
  emailData: Record<string, unknown>,
  vendorsMap: Map<string, unknown> | null,
): Promise<ClassifyOutcome> {
  const ruleClassification = await classifyEmailMessage(emailData, vendorsMap);

  if (isDeterministicRuleResult(ruleClassification)) {
    return {
      classification: finalizeClassification({
        ...ruleClassification,
        confidenceSource: 'rule',
      }),
      escalatedToLlm: false,
    };
  }

  if (ruleClassification.direction !== 'received') {
    return {
      classification: finalizeClassification({
        ...ruleClassification,
        confidenceSource: 'rule',
      }),
      escalatedToLlm: false,
    };
  }

  if (!llmEnabled()) {
    return {
      classification: finalizeClassification({
        ...ruleClassification,
        confidenceSource: 'rule',
      }),
      escalatedToLlm: false,
    };
  }

  try {
    const llmResult = await llmClassifyEmailMessage(emailData, ruleClassification);
    const merged = preserveVendorFromRules(ruleClassification, {
      ...llmResult,
      classificationReason: `${ruleClassification.classificationReason}; ${llmResult.classificationReason || 'LLM classified'}`,
      confidenceSource: 'llm',
    });

    return {
      classification: finalizeClassification(merged),
      escalatedToLlm: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      classification: finalizeClassification({
        ...ruleClassification,
        classificationReason: `${ruleClassification.classificationReason}; LLM failed (${message}) — kept rules`,
        confidenceSource: 'rule',
      }),
      escalatedToLlm: false,
      llmError: message,
    };
  }
}
