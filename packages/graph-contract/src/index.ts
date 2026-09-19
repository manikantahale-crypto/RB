export {
  GraphDefinitionSchema,
  validateGraphTopology,
  checksumOf,
  type GraphDefinition,
  TRIGGER_ROOT,
  parseInputSource,
  type InputSource,
} from "./graph-definition.js";

export {
  ROUTER_DEFINITIONS,
  ROUTER_KEYS,
  routerDefinition,
  type RouterDefinition,
  type RouterOutcome,
} from "./routers.js";

export {
  SWITCH_OPS,
  SWITCH_PRESETS,
  SwitchConditionSchema,
  SwitchNodeConfigSchema,
  SwitchRuleSchema,
  SwitchWhenSchema,
  consentSwitchPreset,
  decideSwitch,
  emailRouteSwitchPreset,
  evaluateCondition,
  evaluateWhen,
  resolveSwitchOutputLabels,
  resolveSwitchRules,
  switchConfigProblems,
  type ResolvedSwitch,
  type SwitchCondition,
  type SwitchNodeConfig,
  type SwitchOp,
  type SwitchPreset,
  type SwitchRule,
  type SwitchWhen,
} from "./switch-config.js";
