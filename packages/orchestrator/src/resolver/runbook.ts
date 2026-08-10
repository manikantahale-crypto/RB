export interface ResolveContext {
  organization_id: string;
  payload: Record<string, any>;
}

export interface RunbookResolver {
  resolve(eventType: string, context: ResolveContext): string;
}

export class SimpleRunbookResolver implements RunbookResolver {
  private routingTable: Record<string, string>;

  constructor(routingTable: Record<string, string>) {
    this.routingTable = routingTable;
  }

  /** Returns null when no runbook exists (terminal / unroutable events). */
  public tryResolve(eventType: string): string | null {
    return this.routingTable[eventType] ?? null;
  }

  public resolve(eventType: string, context: ResolveContext): string {
    const runbook = this.tryResolve(eventType);
    if (!runbook) {
      throw new Error(`No runbook defined for event type: ${eventType}`);
    }
    return runbook;
  }
}
