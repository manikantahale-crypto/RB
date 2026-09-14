/**
 * The two-person rule, tested where it is decided.
 *
 * This control was designed in V20260909.49, described in comments in two
 * files, and implemented nowhere: the CHECK constraint those comments name did
 * not exist in any database, and `approveGoLive` never compared the two
 * identities. One caller requested a go-live and approved it, as the same
 * identity, and the version went live.
 *
 * The case that made it slip through is the one at the top: both sides arrive
 * as LABELS, not uuids, because that is what the admin screens send. A rule
 * written against the uuid columns alone finds NULL on both sides and passes.
 */

import { describe, expect, it } from "vitest";
import { isSamePerson } from "./authoring-writes.js";

describe("isSamePerson", () => {
  it("catches the same label twice — what the admin screens actually send", () => {
    // x-admin-id: admin-local, on both the request and the approval. Neither
    // resolves to a row in platform.users, so both land in *_by_label and both
    // uuid columns are NULL.
    expect(isSamePerson("admin-local", "admin-local")).toBe(true);
    expect(isSamePerson("alice", "alice")).toBe(true);
  });

  it("catches the same uuid twice", () => {
    const id = "22222222-2222-2222-2222-222222222222";
    expect(isSamePerson(id, id)).toBe(true);
  });

  it("allows two different people", () => {
    expect(isSamePerson("approver-two", "author-one")).toBe(false);
    expect(
      isSamePerson(
        "22222222-2222-2222-2222-222222222222",
        "33333333-3333-3333-3333-333333333333",
      ),
    ).toBe(false);
  });

  it("does not confuse a uuid with a label", () => {
    // A user who resolves and one who does not are two different people, even
    // if somebody names an account after an id.
    expect(
      isSamePerson("22222222-2222-2222-2222-222222222222", "admin-local"),
    ).toBe(false);
  });

  it("treats an unknown side as not provably the same person", () => {
    // Most existing versions carry no attribution at all. Refusing those here
    // would block approving anything seeded or deployment-labelled; the
    // database constraint takes the stricter line for rows that record both
    // acts and neither identity.
    expect(isSamePerson(null, "alice")).toBe(false);
    expect(isSamePerson("alice", null)).toBe(false);
    expect(isSamePerson(null, null)).toBe(false);
  });

  it("is not defeated by stray whitespace", () => {
    // A header value with a trailing space is the same person, and comparing
    // raw strings would let them approve their own request.
    expect(isSamePerson("alice ", "alice")).toBe(true);
    expect(isSamePerson(" admin-local", "admin-local ")).toBe(true);
  });

  it("is case sensitive, deliberately", () => {
    // These are identifiers, not names. Folding case would make `Alice` and
    // `alice` one person on a platform where they may be two accounts.
    expect(isSamePerson("Alice", "alice")).toBe(false);
  });
});
