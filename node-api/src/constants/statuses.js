// mirrors the CHECK constraints in your Supabase tables
module.exports = {
  match: {
    WAITING: "waiting",
    READY: "ready",
    REQUESTED: "requested",
    PROCESSING: "processing",
    COMPLETED: "completed",
    FAILED: "failed",
  },
};
