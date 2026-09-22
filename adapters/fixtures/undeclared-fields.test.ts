/**
 * The guard that has nothing to catch today, proved to catch it.
 *
 * `run-fixtures.test.ts` passes on all 61 worked examples, which means the
 * check it added has never once fired. A check nobody has seen fail is a
 * check nobody knows works — so here is the case it exists for, built on
 * purpose.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { undeclaredFields } from "@tekisho/node-contract";

const Output = z.object({ jobId: z.string(), status: z.string() });

describe("undeclaredFields", () => {
  it("names the field a worked example claims that the schema strips", () => {
    // What the real bug looks like: the node returns a thread id, the fixture
    // says so, and the output schema never mentions it — so the bridge deletes
    // it and nothing downstream can be wired to it.
    const fixture = { jobId: "j-1", status: "sent", thread_id: "t-1" };
    const kept = Output.parse(fixture);
    expect(undeclaredFields(fixture, kept)).toEqual(["thread_id"]);
  });

  it("is quiet when the example and the schema agree", () => {
    const fixture = { jobId: "j-1", status: "sent" };
    expect(undeclaredFields(fixture, Output.parse(fixture))).toEqual([]);
  });

  it("does not complain about a declared field the example leaves out", () => {
    // An optional field nobody set is not drift — the example is just smaller
    // than the schema allows, which every fixture is.
    const Loose = z.object({ jobId: z.string(), note: z.string().optional() });
    const fixture = { jobId: "j-1" };
    expect(undeclaredFields(fixture, Loose.parse(fixture))).toEqual([]);
  });
});
