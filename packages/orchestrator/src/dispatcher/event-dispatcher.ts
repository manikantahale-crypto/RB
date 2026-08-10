// Event dispatch helpers live in the worker today:
// - apps/worker/src/bootstrap-pgboss.ts (orchestration.dispatch + Syntra bridge)
// - apps/worker/src/workers/module-execute.worker.ts (module.* after router)
// Ingress entry: packages/orchestrator/src/ingress/accept-platform-event.ts
