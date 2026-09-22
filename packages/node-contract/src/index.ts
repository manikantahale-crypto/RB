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
  contractFilePath,
  isEditorTestable,
  requiresAllowlist,
  fixtureMatchMode,
  adminExposedFields,

  // the serializable half
  toRegistryRow,
  checksumOf,
} from "./node-contract.js";

/**
 * Which steps the platform deduplicates, and the key it uses.
 *
 * Here rather than in the engine because it reads declared fields only, and
 * because the authoring API needs the same answer to tell an author whether a
 * duplicate in their workflow will be absorbed or will really run twice — and
 * the authoring API cannot import the engine.
 */
export {
  DEDUPLICATED_SIDE_EFFECTS,
  isDeduplicable,
  idempotencyKeyOf,
  keyPathsOf,
  keyDerivableFrom,
} from "./idempotency-policy.js";

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

/**
 * The fields a node returns that its own contract does not declare.
 *
 * In this package because both halves of the problem live outside it and must
 * agree: the fixture runner in `adapters/` checks the worked examples, and the
 * runtime bridge in the orchestrator checks what a node really returned. Two
 * copies of this rule would be two rules.
 */
export { undeclaredFields } from "./undeclared-fields.js";
