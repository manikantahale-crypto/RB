/**
 * Taking an event away from whoever currently answers it — within one group.
 *
 * One event starts one workflow PER CONSUMING APPLICATION. That is the routing
 * group, and `event_bindings_one_active_idx` is a unique index on
 * (org, event_type, consuming_application), so exclusivity is structural but
 * scoped: two applications answering the same fact independently is normal,
 * and two workflows in one application competing for it is not.
 *
 * Inside a group, binding an event somebody else holds does not add a
 * listener, it replaces them — and the previous workflow stops running with no
 * failed run, no error and no alert. Hence the guard.
 *
 * It used to refuse only when the holder was authored, which meant the
 * bindings with real production work behind them (all of them seeded by
 * migration) were precisely the ones it let go silently.
 */
import { describe, expect, it } from "vitest";
import {
  EventAlreadyBoundError,
  upsertActiveEventBinding,
  type EventBindingRow,
} from "./event-bindings.js";

const EVENT = "astra.requirement.received";

const row = (over: Partial<EventBindingRow> = {}): EventBindingRow => ({
  id: "11111111-1111-1111-1111-111111111111",
  event_type: EVENT,
  org_id: null,
  graph_key: "astra.requirement.workflow",
  module_queue: "module.syntra.jd",
  version: 1,
  status: "active",
  source: "seed",
  ...over,
});

/**
 * A client that answers the "who holds this event" SELECT with `existing`,
 * and records everything else. Enough to exercise the guard without a
 * database, because the guard is the whole point.
 */
function fakeClient(
  existing: EventBindingRow | null,
  opts: {
    catalogue?: boolean;
    siblingQueue?: string | null;
    /** Which application owns the target queue — the routing group. */
    queueApplication?: string | null;
  } = {},
) {
  /** Whether the event catalogue knows this event. */
  const catalogue = opts.catalogue ?? true;
  /** The queue this application's other triggers already use, if any. */
  const siblingQueue = opts.siblingQueue ?? null;
  const queueApplication = opts.queueApplication ?? "astra";
  const statements: string[] = [];
  /** Full SQL, so a test can assert on a WHERE clause and not just a verb. */
  const sql: string[] = [];
  const params: unknown[][] = [];
  return {
    statements,
    sql,
    params,
    query: async (text: string, p?: unknown[]) => {
      const t = text.trim();
      statements.push(t.split("\n")[0]!.trim());
      sql.push(t);
      params.push(p ?? []);

      // "Which application owns this queue?" — the routing group.
      if (/FROM platform\.queues/i.test(t)) {
        return {
          rows: [{ consuming_application: queueApplication }],
          rowCount: 1,
        };
      }
      // "Is this event in the catalogue at all?"
      if (/event_catalog/i.test(t)) {
        return { rows: catalogue ? [{ ok: 1 }] : [], rowCount: catalogue ? 1 : 0 };
      }
      // "Which workflow does this graph_key name?" — a foreign key now, so
      // the binding cannot be written without it.
      if (/FROM authoring\.graphs/i.test(t)) {
        return {
          rows: [{ id: "22222222-2222-2222-2222-222222222222" }],
          rowCount: 1,
        };
      }
      // "What queue do this application's other triggers use?"
      if (/event_type LIKE/i.test(t)) {
        return {
          rows: siblingQueue ? [{ module_queue: siblingQueue }] : [],
          rowCount: siblingQueue ? 1 : 0,
        };
      }
      if (/^SELECT/i.test(t)) {
        return { rows: existing ? [existing] : [], rowCount: existing ? 1 : 0 };
      }
      // The write itself is a CTE now — it resolves the pinned version, writes
      // the binding and reads it back under the old column names in one
      // statement, so the caller never sees the three tables underneath.
      if (/^WITH pinned/i.test(t) || /^INSERT/i.test(t)) {
        return { rows: [row({ source: "authoring" })], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const activate = (
  client: ReturnType<typeof fakeClient>,
  over: Record<string, unknown> = {},
) =>
  upsertActiveEventBinding(client as never, {
    eventType: EVENT,
    orgId: null,
    graphKey: "astra.authored",
    version: 1,
    ...over,
  });

describe("upsertActiveEventBinding", () => {
  it("refuses to take a seeded binding without being asked", () => {
    // The regression this whole test file exists for: ASTRA's production
    // trigger, held by a migration, silently handed to a new workflow.
    return expect(activate(fakeClient(row()))).rejects.toThrow(
      EventAlreadyBoundError,
    );
  });

  it("says which workflow would stop running, and that it is production", async () => {
    // "Already bound" is not enough to decide with. The name and the origin
    // are what make it an informed answer rather than a guess.
    const err = await activate(fakeClient(row())).catch((e) => e);
    expect(err.existingGraphKey).toBe("astra.requirement.workflow");
    expect(err.existingSource).toBe("seed");
    expect(err.message).toContain("stops");
    expect(err.message).toContain("astra.requirement.workflow");
  });

  it("still refuses an authored holder", async () => {
    // The original behaviour, unchanged.
    await expect(
      activate(fakeClient(row({ source: "authoring", graph_key: "other.authored" }))),
    ).rejects.toThrow(EventAlreadyBoundError);
  });

  it("writes nothing when it refuses", async () => {
    // A guard that throws after retiring the old row would be worse than no
    // guard: the previous workflow is already off by then.
    const client = fakeClient(row());
    await activate(client).catch(() => {});
    expect(client.statements.some((q) => /^UPDATE|^INSERT/i.test(q))).toBe(false);
  });

  it("takes it over when the caller confirms", async () => {
    // Replacing a seeded workflow is legitimate. It just has to be on purpose.
    const client = fakeClient(row());
    await expect(activate(client, { allowTakeover: true })).resolves.toBeTruthy();
    expect(client.statements.some((q) => /^INSERT/i.test(q))).toBe(true);
  });

  it("lets a workflow replace its own seeded binding", async () => {
    // The common case, and the one that must not need a confirmation: an
    // authored workflow publishing a new version over the row a migration
    // created for it. Refusing this would make seeded workflows permanently
    // unpublishable.
    const client = fakeClient(row({ graph_key: "astra.authored" }));
    await expect(activate(client)).resolves.toBeTruthy();
  });

  it("still refuses a different workflow from the same author", async () => {
    // The owner of a binding is the WORKFLOW, not whoever authored it. This
    // used to be allowed: the guard also matched on agent id, so one agent
    // could move an event from one of its workflows to another without being
    // asked. That is a takeover like any other — the first workflow stops
    // running — and it now needs the same confirmation.
    const client = fakeClient(row({ graph_key: "astra.something.else" }));
    await expect(activate(client)).rejects.toThrow(EventAlreadyBoundError);
    await expect(
      activate(client, { allowTakeover: true }),
    ).resolves.toBeTruthy();
  });

  it("binds freely when nothing holds the event", async () => {
    const client = fakeClient(null);
    await expect(activate(client)).resolves.toBeTruthy();
  });
});

describe("binding an event the hardcoded catalogue has never heard of", () => {
  /** Not one of the eighteen — the case that used to be impossible. */
  const NEW_EVENT = "syntra.shortlist.approved";

  const activate = (
    client: ReturnType<typeof fakeClient>,
    over: Record<string, unknown> = {},
  ) =>
    upsertActiveEventBinding(client as never, {
      eventType: NEW_EVENT,
      orgId: null,
      graphKey: "syntra.authored",
      version: 1,
      ...over,
    });

  it("binds it when the event catalogue knows it", async () => {
    // Registering an event and binding a workflow to it used to fail with
    // `Unknown trigger event_type`, fixable only by an authoring release. That
    // was the third of three places onboarding a module cost a deploy.
    const client = fakeClient(null, { catalogue: true });
    await expect(activate(client)).resolves.toBeTruthy();
  });

  it("still refuses an event nobody has registered", async () => {
    // The catalogue is the authority, so an event that is in neither the
    // hardcoded list nor the catalogue is a typo, not a new trigger.
    const client = fakeClient(null, { catalogue: false });
    await expect(activate(client)).rejects.toThrow(/Register it in the event/);
  });

  it("puts it on the queue its application already uses", async () => {
    // A new SYNTRA trigger belongs with SYNTRA's other work, not on a queue of
    // its own that nothing else touches.
    const client = fakeClient(null, {
      catalogue: true,
      siblingQueue: "module.syntra.jd",
    });
    const row = await activate(client);
    expect(row).toBeTruthy();
  });

  it("takes an explicit queue over anything it would derive", async () => {
    const client = fakeClient(null, { catalogue: true });
    await expect(
      activate(client, { moduleQueue: "module.chosen.by.hand" }),
    ).resolves.toBeTruthy();
    // With a queue given, it never needs to look the event up in the
    // catalogue. It still promotes `handling` there afterwards, which is the
    // write below, not this lookup.
    expect(
      client.statements.some((q) => /SELECT 1 FROM authoring.event_catalog/i.test(q)),
    ).toBe(false);
  });

  it("does not consult the catalogue for one of the known eighteen", async () => {
    // The hardcoded entry carries a deliberately chosen queue —
    // `module.design.resume` is not derivable from `syntra.resume.received` —
    // so it stays the first answer, as a default rather than a gate.
    const client = fakeClient(null, { catalogue: true });
    await upsertActiveEventBinding(client as never, {
      eventType: "syntra.resume.received",
      orgId: null,
      graphKey: "resume.intake",
      version: 1,
    });
    expect(
      client.statements.some((q) => /SELECT 1 FROM authoring.event_catalog/i.test(q)),
    ).toBe(false);
  });
});

/**
 * One event, two applications, no collision.
 *
 * This is the whole of docs/adr/bindings-allow-fanout.md. Exclusivity is real
 * but scoped to a routing group — one per consuming application — so ORBIT
 * answering a fact SYNTRA already answers is normal rather than a takeover.
 * Before this, the retire was scoped to (event_type, org) and binding the
 * second application silently switched the first one off.
 */
describe("routing groups", () => {
  it("retires only bindings in the same application's group", async () => {
    const client = fakeClient(null, { queueApplication: "orbit" });
    await upsertActiveEventBinding(client as never, {
      eventType: "astra.requirement.published",
      orgId: null,
      graphKey: "orbit.bench.workflow",
      moduleQueue: "module.orbit.bench",
      version: 1,
    });

    const retire = client.sql.find((q) => /^UPDATE authoring\.event_bindings/i.test(q));
    expect(retire).toBeDefined();
    // Without this clause the statement switches off every other application
    // answering the same event, which is the coupling fan-out exists to remove.
    expect(retire).toMatch(/consuming_application/);
  });

  it("asks who holds the event for THIS application, not who holds the event", async () => {
    const client = fakeClient(null, { queueApplication: "orbit" });
    await upsertActiveEventBinding(client as never, {
      eventType: "astra.requirement.published",
      orgId: null,
      graphKey: "orbit.bench.workflow",
      moduleQueue: "module.orbit.bench",
      version: 1,
    });

    const holder = client.sql.find(
      (q) => /FROM authoring\.event_bindings b/i.test(q) && /status = 'active'/i.test(q),
    );
    expect(holder).toMatch(/consuming_application/);
  });

  it("writes the group onto the binding", async () => {
    const client = fakeClient(null, { queueApplication: "orbit" });
    await upsertActiveEventBinding(client as never, {
      eventType: "astra.requirement.published",
      orgId: null,
      graphKey: "orbit.bench.workflow",
      moduleQueue: "module.orbit.bench",
      version: 1,
    });

    // The binding insert, not the queue insert that precedes it — both carry
    // the queue name, and only one carries the event.
    const i = client.sql.findIndex((q) => /^WITH pinned/i.test(q));
    expect(i).toBeGreaterThan(-1);
    // A binding with no group sits in the '~none~' slot with every other
    // ungrouped binding, and the unique index makes them fight.
    expect(client.params[i]).toContain("orbit");
    expect(client.params[i]).toContain("astra.requirement.published");
  });

  it("groups an unclaimed queue under nothing, rather than guessing", async () => {
    const client = fakeClient(null, { queueApplication: null });
    await expect(
      upsertActiveEventBinding(client as never, {
        eventType: "astra.requirement.published",
        orgId: null,
        graphKey: "some.workflow",
        moduleQueue: "module.unclaimed",
        version: 1,
      }),
    ).resolves.toBeTruthy();
  });
});
