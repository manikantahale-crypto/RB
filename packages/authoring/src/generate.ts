/** Re-export graph generator as the primary Stage 1 Generate entry. */
export {
  generateGraphFromTemplate,
  type GenerateGraphResult,
} from "./generate-graph.js";
export { generateAgentTs, type GenerateResult } from "./generate-agent-ts.js";
