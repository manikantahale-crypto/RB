import { StateGraph, Annotation, type CompiledGraph } from '@langchain/langgraph';
import { Registry } from './registry.js';
import type { GraphDefinition } from '../resolver.js';
import type { EventInput } from '../types.js';

export const SyntraState = Annotation.Root({
  trigger_event: Annotation<EventInput>({
    reducer: (x, y) => y ?? x,
    default: () => ({ event_id: '', event_type: '', aggregate_id: '', payload: {} })
  }),
  syntraResult: Annotation<any>({
    reducer: (x, y) => y ?? x,
    default: () => null
  }),
  _emittedEvents: Annotation<EventInput[]>({
    reducer: (x, y) => x.concat(y || []),
    default: () => []
  })
});

export class GraphCompiler {
  public static compile(graphDef: GraphDefinition): CompiledGraph<any, any, any> {
    const { graph_key, definition } = graphDef;

    if (!definition || !Array.isArray(definition.nodes) || !Array.isArray(definition.edges)) {
      throw new Error(`Invalid graph definition for ${graph_key}: Missing nodes or edges array`);
    }

    const graph = new StateGraph(SyntraState);

    for (const node of definition.nodes) {
      if (!node.id || !node.impl) {
        throw new Error(`Invalid node in ${graph_key}: Missing id or impl`);
      }
      
      const implFunction = Registry.getNodeImplementation(node.impl);
      graph.addNode(node.id, implFunction);
    }

    for (const edge of definition.edges) {
      if (!Array.isArray(edge) || edge.length !== 2) {
        throw new Error(`Invalid edge in ${graph_key}: Edge must be a tuple [from, to]`);
      }
      graph.addEdge(edge[0], edge[1]);
    }

    // Default checkpointing is NOT wired here yet per Phase 23 constraint.
    return graph.compile();
  }
}
