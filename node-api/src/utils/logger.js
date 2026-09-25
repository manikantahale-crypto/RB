const ts = () => new Date().toISOString();

const isDebugEnabled = () => {
  const v = process.env.DEBUG_MODE || process.env.DEBUG;
  return v === "true" || v === "1" || v === "yes";
};

module.exports = {
  isDebugEnabled,
  debug: (...a) => {
    if (isDebugEnabled()) {
      console.log(`[${ts()}] DEBUG`, ...a);
    }
  },
  info: (...a) => console.log(`[${ts()}] INFO`, ...a),
  warn: (...a) => console.warn(`[${ts()}] WARN`, ...a),
  error: (...a) => console.error(`[${ts()}] ERROR`, ...a),
};
