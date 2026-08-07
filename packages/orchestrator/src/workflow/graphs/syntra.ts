/**
 * @deprecated Prefer DB graph_definitions + GraphCompiler + node registry.
 * Kept as thin wrappers for scripts/tests that still import named graphs.
 */
import { nodeRegistry } from '../../nodes/registry.js';
import type { EventInput } from '../../types.js';
import { Annotation, StateGraph } from '@langchain/langgraph';

const SyntraState = Annotation.Root({
  result: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => '' }),
  _emittedEvents: Annotation<EventInput[]>({
    reducer: (x, y) => x.concat(y ?? []),
    default: () => [],
  }),
  trigger_event: Annotation<EventInput | null>({
    reducer: (x, y) => y ?? x,
    default: () => null,
  }),
});

function compileOne(implKey: keyof typeof nodeRegistry) {
  const impl = nodeRegistry[implKey]();
  return new StateGraph(SyntraState)
    .addNode('process', async (state) =>
      impl(state, {
        orgId: state.trigger_event?.organization_id ?? '',
        config: {},
        logger: console,
      })
    )
    .addEdge('__start__', 'process')
    .addEdge('process', '__end__')
    .compile();
}

export const jdGraph = compileOne('syntra.jd.process');
export const resumeGraph = compileOne('syntra.resume.process');
export const matchGraph = compileOne('syntra.match.process');
