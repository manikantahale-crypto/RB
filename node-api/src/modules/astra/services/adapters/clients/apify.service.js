function redactToken(str) {
  if (!str) return str;
  const token = process.env.APIFY_API_TOKEN;
  if (token) {
    return str.split(token).join("[REDACTED]");
  }
  return str;
}

async function runActorAndGetDataset(actorId, input) {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    throw new Error("Apify API Token is missing. Set APIFY_API_TOKEN in environment.");
  }
  if (!actorId) {
    throw new Error("Apify Actor ID is missing.");
  }

  const apiActorId = actorId.replace("/", "~");
  const runUrl = `https://api.apify.com/v2/actors/${apiActorId}/runs?token=${token}`;

  const response = await fetch(runUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(redactToken(`Failed to start Apify actor ${actorId}: ${response.statusText} - ${errorText}`));
  }

  const runData = await response.json();
  const runId = runData.data.id;
  const defaultDatasetId = runData.data.defaultDatasetId;

  console.log(`[Apify] Started run ${runId} for Actor ${actorId}. Polling for completion...`);

  const pollInterval = 3000;
  const maxPolls = 100; // 5 minutes max
  let pollCount = 0;

  while (pollCount < maxPolls) {
    const statusUrl = `https://api.apify.com/v2/actor-runs/${runId}?token=${token}`;
    const statusResponse = await fetch(statusUrl);
    if (!statusResponse.ok) {
      throw new Error(redactToken(`Failed to check run status: ${statusResponse.statusText}`));
    }

    const statusData = await statusResponse.json();
    const status = statusData.data.status;

    if (status === "SUCCEEDED") {
      console.log(`[Apify] Actor run ${runId} succeeded.`);
      break;
    } else if (status === "FAILED" || status === "TIMED-OUT" || status === "ABORTED") {
      throw new Error(`Apify Actor run ${runId} finished with status: ${status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    pollCount++;
  }

  if (pollCount >= maxPolls) {
    throw new Error(`Apify Actor run ${runId} timed out.`);
  }

  const datasetUrl = `https://api.apify.com/v2/datasets/${defaultDatasetId}/items?token=${token}`;
  const datasetResponse = await fetch(datasetUrl);
  if (!datasetResponse.ok) {
    throw new Error(redactToken(`Failed to retrieve dataset items: ${datasetResponse.statusText}`));
  }

  const items = await datasetResponse.json();
  return items;
}

module.exports = { runActorAndGetDataset };
