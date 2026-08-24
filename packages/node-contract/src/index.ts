export {
  // the contract
  NodeContractSchema,
  defineNode,
  type NodeContract,
  type NodeContractInput,
  type AnyNodeContract,
  type NodeRunCtx,
  type EmittedEvent,
  type NodeFixture,

  // field schemas and their vocabularies
  SideEffectSchema,
  IdempotencySchema,
  ExecutionSchema,
  PersistenceSchema,
  PersistenceModeSchema,
  FixtureSchema,
  MODULES,
  DEPENDENCIES,
  type Module,
  type Dependency,
  type SideEffect,
  type Idempotency,
  type ErrorClass,

  // projections — derived, never hand-maintained
  registryKey,
  isEditorTestable,
  requiresAllowlist,
  fixtureMatchMode,
  adminExposedFields,

  // the serializable half
  toRegistryRow,
  checksumOf,
} from "./node-contract.js";
