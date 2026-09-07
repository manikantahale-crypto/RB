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
  EmitDeclarationSchema,
  resolveEmits,
  type EmitDeclaration,
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

/**
 * What each application is for, and how work moves between them.
 *
 * Separate from the node contract because it answers a different question:
 * the contract says what one step does, this says which application a step
 * belongs to and what comes before it.
 */
export {
  MODULE_REGISTRY,
  moduleEdges,
  orderModules,
  moduleForFrontDoor,
  modulePublishing,
  type ModuleSpec,
  type ModuleEdge,
} from "./module-registry.js";
