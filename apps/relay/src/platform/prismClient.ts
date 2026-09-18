/**
 * PRISM Client — bridges RELAY email ingestion with PRISM workflow state machine.
 */

const SYNTRA_BASE = (
  process.env.SYNTRA_API_URL ||
  process.env.NODE_API_URL ||
  "http://localhost:4000"
).replace(/\/$/, "");

export interface ForwardConsentParams {
  submissionId?: string | null;
  candidateId?: string | null;
  jobId?: string | null;
  senderEmail?: string | null;
  decision: "approved" | "rejected";
  notes?: string | null;
  messageId?: string | null;
  threadId?: string | null;
}

export interface PrismConsentResponseResult {
  status: "success" | "already_processed" | "ambiguous_or_not_found" | "failed";
  submissionId?: string;
  newStatus?: string;
  message?: string;
  error?: string;
}

export async function forwardConsentToPrism(
  params: ForwardConsentParams
): Promise<PrismConsentResponseResult> {
  const targetUrl = `${SYNTRA_BASE}/internal/prism/consent/response`;

  console.log(
    `[relay/prismClient] Forwarding consent response to PRISM: decision=${params.decision}, candidate=${params.candidateId}, submission=${params.submissionId}`
  );

  const payload = {
    submissionId: params.submissionId || undefined,
    candidateId: params.candidateId || undefined,
    jobId: params.jobId || undefined,
    senderEmail: params.senderEmail || undefined,
    response: params.decision === "approved" ? "ACCEPTED" : "REJECTED",
    notes: params.notes || undefined,
    messageId: params.messageId || undefined,
    threadId: params.threadId || undefined,
  };

  try {
    const res = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.warn(
        `[relay/prismClient] PRISM API returned ${res.status}:`,
        data.message || data.error || res.statusText
      );

      return {
        status: "failed",
        error: data.message || data.error || `HTTP ${res.status}`,
      };
    }

    console.log(
      `[relay/prismClient] PRISM consent update successful: status=${data.status}, submissionId=${data.submissionId}, newStatus=${data.newStatus}`
    );

    return data;
  } catch (err: any) {
    console.error(
      `[relay/prismClient] Failed to reach PRISM API (${targetUrl}):`,
      err.message
    );

    return {
      status: "failed",
      error: err.message,
    };
  }
}

export interface ForwardConfirmationParams {
  submissionId?: string | null;
  candidateId?: string | null;
  jobId?: string | null;
  vendorId?: string | null;
  party: "consultant" | "vendor";
  senderEmail?: string | null;
  decision: "confirmed" | "declined";
  notes?: string | null;
  messageId?: string | null;
}

export async function forwardConfirmationToPrism(
  params: ForwardConfirmationParams
): Promise<PrismConsentResponseResult> {
  const targetUrl = `${SYNTRA_BASE}/internal/prism/confirmation/response`;

  console.log(
    `[relay/prismClient] Forwarding confirmation response to PRISM: party=${params.party}, decision=${params.decision}, submission=${params.submissionId}`
  );

  const payload = {
    submissionId: params.submissionId || undefined,
    candidateId: params.candidateId || undefined,
    jobId: params.jobId || undefined,
    vendorId: params.vendorId || undefined,
    party: params.party,
    senderEmail: params.senderEmail || undefined,
    response:
      params.decision === "confirmed" ? "CONFIRMED" : "DECLINED",
    notes: params.notes || undefined,
    messageId: params.messageId || undefined,
  };

  try {
    const res = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.warn(
        `[relay/prismClient] PRISM confirmation API returned ${res.status}:`,
        data.message || data.error || res.statusText
      );

      return {
        status: "failed",
        error: data.message || data.error || `HTTP ${res.status}`,
      };
    }

    console.log(
      `[relay/prismClient] PRISM confirmation update successful: status=${data.status}, submissionId=${data.submissionId}, newStatus=${data.newStatus}`
    );

    return data;
  } catch (err: any) {
    console.error(
      `[relay/prismClient] Failed to reach PRISM API (${targetUrl}):`,
      err.message
    );

    return {
      status: "failed",
      error: err.message,
    };
  }
}

export interface ForwardVendorParams {
  submissionId?: string | null;
  candidateId?: string | null;
  jobId?: string | null;
  senderEmail?: string | null;
  decision: "accepted" | "rejected";
  notes?: string | null;
  messageId?: string | null;
  threadId?: string | null;
}

export async function forwardVendorResponseToPrism(
  params: ForwardVendorParams
): Promise<PrismConsentResponseResult> {
  const targetUrl = `${SYNTRA_BASE}/internal/prism/vendor/response`;

  console.log(
    `[relay/prismClient] Forwarding vendor response to PRISM: decision=${params.decision}, submission=${params.submissionId}`
  );

  const payload = {
    submissionId: params.submissionId || undefined,
    candidateId: params.candidateId || undefined,
    jobId: params.jobId || undefined,
    senderEmail: params.senderEmail || undefined,
    response:
      params.decision === "accepted" ? "ACCEPTED" : "REJECTED",
    notes: params.notes || undefined,
    messageId: params.messageId || undefined,
    threadId: params.threadId || undefined,
  };

  try {
    const res = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.warn(
        `[relay/prismClient] PRISM vendor API returned ${res.status}:`,
        data.message || data.error || res.statusText
      );

      return {
        status: "failed",
        error: data.message || data.error || `HTTP ${res.status}`,
      };
    }

    console.log(
      `[relay/prismClient] PRISM vendor response update successful: status=${data.status}, submissionId=${data.submissionId}, newStatus=${data.newStatus}`
    );

    return data;
  } catch (err: any) {
    console.error(
      `[relay/prismClient] Failed to reach PRISM API (${targetUrl}):`,
      err.message
    );

    return {
      status: "failed",
      error: err.message,
    };
  }
}

export interface ForwardRTRParams {
  submissionId?: string | null;
  candidateId?: string | null;
  jobId?: string | null;
  vendorId?: string | null;
  senderEmail?: string | null;
  decision: "signed" | "declined";
  notes?: string | null;
  messageId?: string | null;
}

export async function forwardRTRToPrism(
  params: ForwardRTRParams
): Promise<PrismConsentResponseResult> {
  const targetUrl = `${SYNTRA_BASE}/internal/prism/rtr/response`;

  console.log(
    `[relay/prismClient] Forwarding RTR response to PRISM: decision=${params.decision}, submission=${params.submissionId}`
  );

  const payload = {
    submissionId: params.submissionId || undefined,
    candidateId: params.candidateId || undefined,
    jobId: params.jobId || undefined,
    vendorId: params.vendorId || undefined,
    senderEmail: params.senderEmail || undefined,
    response:
      params.decision === "signed" ? "SIGNED" : "DECLINED",
    notes: params.notes || undefined,
    messageId: params.messageId || undefined,
  };

  try {
    const res = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.warn(
        `[relay/prismClient] PRISM RTR API returned ${res.status}:`,
        data.message || data.error || res.statusText
      );

      return {
        status: "failed",
        error: data.message || data.error || `HTTP ${res.status}`,
      };
    }

    console.log(
      `[relay/prismClient] PRISM RTR update successful: status=${data.status}, submissionId=${data.submissionId}, newStatus=${data.newStatus}`
    );

    return data;
  } catch (err: any) {
    console.error(
      `[relay/prismClient] Failed to reach PRISM API (${targetUrl}):`,
      err.message
    );

    return {
      status: "failed",
      error: err.message,
    };
  }
}