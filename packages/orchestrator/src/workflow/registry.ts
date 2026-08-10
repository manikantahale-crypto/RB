import type { CompiledGraph } from '@langchain/langgraph';
import { processJdNode, processResumeNode, processMatchNode } from './nodes/syntra.js';

type NodeImplementation = (state: any) => Promise<any>;

export class Registry {
  // Workflow Graph Cache
  private workflows = new Map<string, CompiledGraph<any, any, any>>();

  public static buildCacheKey(orgId: string | null, graphKey: string, checksum: string): string {
    return `${orgId || 'global'}::${graphKey}::${checksum}`;
  }

  public registerGraph(cacheKey: string, graph: CompiledGraph<any, any, any>): void {
    this.workflows.set(cacheKey, graph);
  }

  public getGraph(cacheKey: string): CompiledGraph<any, any, any> | undefined {
    return this.workflows.get(cacheKey);
  }

  // Node Implementation Registry
  private static nodeImpls: Map<string, NodeImplementation> = new Map([
    ['syntra.jd.process', processJdNode],
    ['syntra.resume.process', processResumeNode],
    ['syntra.match.process', processMatchNode],
  ]);

  public static getNodeImplementation(name: string): NodeImplementation {
    const impl = this.nodeImpls.get(name);
    if (!impl) {
      throw new Error(`Node implementation not found: ${name}`);
    }
    return impl;
  }
}
