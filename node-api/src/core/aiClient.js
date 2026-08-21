const OpenAI = require("openai");
const { getAiConfig } = require("../config/aiConfig");

function getOpenAIClient() {
  const config = getAiConfig();
  return new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey || "dummy-key",
    maxRetries: 3,
    defaultHeaders: {
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "Syntra ATS",
    },
  });
}

async function complete(prompt, { system = "", modelKey = "reason", temperature = 0.1, maxTokens } = {}) {
  const config = getAiConfig();
  const currentClient = getOpenAIClient();

  const modelMap = {
    reason: config.model,
    fast: config.modelFast,
  };

  const selectedModel = modelMap[modelKey] || modelKey || config.model;

  const messages = [];
  if (system) {
    messages.push({ role: "system", content: system });
  }
  messages.push({ role: "user", content: prompt });

  const startMs = Date.now();
  let resp;
  try {
    resp = await currentClient.chat.completions.create({
      model: selectedModel,
      messages,
      temperature,
      max_tokens: Number(maxTokens || process.env.AI_MAX_TOKENS || 1500),
    });
  } catch (err) {
    const latency = Date.now() - startMs;
    console.error(`[aiClient] error model=${selectedModel} latency=${latency}ms msg=${err.message}`);
    throw err;
  }
  const latency = Date.now() - startMs;
  console.log(`[aiClient] success model=${selectedModel} latency=${latency}ms tokens=${resp.usage?.total_tokens}`);

  return resp.choices[0].message.content;
}

module.exports = {
  getOpenAIClient,
  complete,
};
