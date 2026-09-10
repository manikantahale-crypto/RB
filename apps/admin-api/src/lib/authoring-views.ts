/**
 * `authoring` presented under the shape admin-api already queries.
 *
 * `public.graph_definitions` was doing three jobs at once — the identity of a
 * workflow, its editable draft, and a version counter — which is how a binding
 * ended up pointing at version 119. The authoring layer splits them into
 * `graphs`, `graph_drafts` and `graph_versions`.
 *
 * Every query in admin-api goes by `graph_key` (plus status, version or
 * org_id) and never by `id`, which is what makes this reconstitution safe: the
 * one column that cannot be reproduced faithfully is the one nothing looks up
 * by.
 *
 * READS ONLY. Writes still go to public.graph_definitions and reach authoring
 * through the mirror in V20260909.25, in the same transaction, so these reads
 * are never behind.
 *
 * VERIFIED AGAINST PRODUCTION BEFORE USE
 *
 *   active   32 rows either way
 *   drafts   83 rows either way
 *   total    610 here against 515 in the table
 *
 * The 95 extra are retired versions that live in `public.graph_versions` and
 * never made it into graph_definitions — two tables that overlapped heavily
 * and neither of which contained the other, which is the clearest argument for
 * having had one. They are a superset, not a conflict: no (graph_key, version)
 * pair appears twice, and none shadows an active version. A query filtering on
 * status sees exactly what it saw before; a query listing every version of a
 * workflow now sees history that was previously invisible.
 */

/**
 * A `graph_definitions` row, rebuilt from the three tables that replaced it.
 *
 * The draft's id is `<graph_key>@draft` and its version is 0 — the reserved
 * working-copy slot the editor now writes. A draft is not a version, so it has
 * no number of its own; 0 is a placeholder for callers that still expect the
 * column, and it can never be `max(version)`.
 */
export const GRAPH_DEFINITIONS = `(
  SELECT v.id::text                       AS id,
         g.org_id::text                   AS org_id,
         g.graph_key,
         v.version,
         v.definition,
         v.checksum,
         CASE v.status WHEN 'live' THEN 'active' ELSE 'retired' END AS status,
         -- created_by held two different kinds of thing: a few real user ids
         -- and several hundred deployment labels like 'stage-v31-relay'. Both
         -- are provenance and both come back out here.
         coalesce(v.compiled_by::text, v.compiled_by_label, 'seed') AS created_by,
         v.compiled_at                    AS created_at,
         CASE WHEN v.status = 'live' THEN v.compiled_at END AS activated_at
    FROM authoring.graph_versions v
    JOIN authoring.graphs g ON g.id = v.graph_id

  UNION ALL

  SELECT g.graph_key || '@draft'          AS id,
         g.org_id::text                   AS org_id,
         g.graph_key,
         0                                AS version,
         d.definition,
         d.checksum,
         'draft'                          AS status,
         coalesce(d.updated_by::text, g.created_by_label, 'seed') AS created_by,
         d.updated_at                     AS created_at,
         NULL::timestamptz                AS activated_at
    FROM authoring.graph_drafts d
    JOIN authoring.graphs g ON g.id = d.graph_id
)`;

/** `authoring.event_catalog` under the name and columns event_schemas had. */
export const EVENT_SCHEMAS = `(
  SELECT event_type, schema_version, description, payload_schema,
         envelope_fields, produced_when, primary_consumer,
         upper(status) AS status, created_at, updated_at,
         -- Not in the old table: what the platform DOES with this event. It is
         -- why the catalogue exists, so it is exposed rather than hidden.
         handling, application, visibility
    FROM authoring.event_catalog
)`;

/** `authoring.event_bindings` under the shape graph_event_bindings had. */
export const GRAPH_EVENT_BINDINGS = `(
  SELECT b.id,
         b.event_type,
         b.org_id,
         g.graph_key,
         b.queue_key      AS module_queue,
         b.status,
         b.source,
         b.created_at,
         b.updated_at,
         b.consuming_application,
         b.priority
    FROM authoring.event_bindings b
    JOIN authoring.graphs g ON g.id = b.graph_id
)`;
