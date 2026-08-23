function isPgPoolExhausted(err) {
  const msg = err?.message ? String(err.message) : String(err);
  return (
    msg.includes("EMAXCONN") ||
    msg.includes("max clients reached") ||
    msg.includes("too many clients")
  );
}

async function withPgRetry(label, fn, attempts = 10) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isPgPoolExhausted(err) || i >= attempts - 1) throw err;
      const waitMs = 2000 * (i + 1);
      console.warn(
        `[${label}] DB pool busy (attempt ${i + 1}/${attempts}) — retry in ${waitMs / 1000}s…`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

module.exports = { isPgPoolExhausted, withPgRetry };
