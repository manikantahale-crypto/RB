/**
 * Safe JSON extraction and repair utility for LLM responses.
 * Handles markdown fences, surrounding text, unescaped newlines/quotes,
 * and truncated JSON objects/strings due to token length limits.
 */

function safeJsonParse(raw) {
  if (!raw || typeof raw !== "string") {
    throw new Error("Empty or non-string input provided for JSON parsing.");
  }

  let text = raw.trim();

  // 1. Strip markdown fences if present
  text = text.replace(/^```(?:json)?\s*/i, "");
  text = text.replace(/\s*```$/i, "");
  text = text.trim();

  // 2. Extract substring from first '{' to last '}' if extra text exists
  const firstBrace = text.indexOf("{");
  if (firstBrace === -1) {
    throw new Error("No JSON object found in response: missing opening '{'.");
  }

  const lastBrace = text.lastIndexOf("}");
  let candidate = (lastBrace > firstBrace) ? text.slice(firstBrace, lastBrace + 1) : text.slice(firstBrace);

  // 3. First attempt: standard JSON.parse
  try {
    return JSON.parse(candidate);
  } catch (err1) {
    // 4. Second attempt: handle unescaped control characters
    try {
      const sanitized = sanitizeControlCharacters(candidate);
      return JSON.parse(sanitized);
    } catch (err2) {
      // 5. Third attempt: repair truncated JSON
      try {
        const repaired = repairTruncatedJson(candidate);
        return JSON.parse(repaired);
      } catch (err3) {
        // 6. Fourth attempt: fallback extraction for raw text from firstBrace
        const fullRepaired = repairTruncatedJson(text.slice(firstBrace));
        return JSON.parse(fullRepaired);
      }
    }
  }
}

/**
 * Replace unescaped control characters inside JSON string literals
 */
function sanitizeControlCharacters(str) {
  return str.replace(/[\x00-\x1F\x7F-\x9F]/g, (char) => {
    if (char === "\n") return "\\n";
    if (char === "\r") return "\\r";
    if (char === "\t") return "\\t";
    return "";
  });
}

/**
 * Repairs unclosed strings, trailing commas, and unclosed arrays/objects
 */
function repairTruncatedJson(jsonStr) {
  let str = jsonStr.trim();

  // Remove any incomplete trailing key-value pair or dangling comma at the end
  str = str.replace(/,\s*"[^"]*"\s*:\s*$/, "");
  str = str.replace(/,\s*$/, "");

  let inString = false;
  let isEscaped = false;
  const stack = [];

  for (let i = 0; i < str.length; i++) {
    const char = str[i];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      isEscaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === "{" || char === "[") {
        stack.push(char);
      } else if (char === "}") {
        if (stack.length > 0 && stack[stack.length - 1] === "{") {
          stack.pop();
        }
      } else if (char === "]") {
        if (stack.length > 0 && stack[stack.length - 1] === "[") {
          stack.pop();
        }
      }
    }
  }

  let repaired = str;

  // If string is left open, close it
  if (inString) {
    repaired += '"';
  }

  // Remove trailing comma if present before closing brackets
  repaired = repaired.replace(/,\s*$/, "");

  // Close any unclosed arrays or objects in reverse order
  while (stack.length > 0) {
    const openChar = stack.pop();
    if (openChar === "{") {
      repaired += "}";
    } else if (openChar === "[") {
      repaired += "]";
    }
  }

  return repaired;
}

module.exports = {
  safeJsonParse,
  repairTruncatedJson,
  sanitizeControlCharacters,
};
