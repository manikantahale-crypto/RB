#!/usr/bin/env bash
#
# Stand the new structure up locally, so it can be used before any Supabase
# project exists.
#
#   ./scripts/new-project-local.sh          start it (keeps its data)
#   ./scripts/new-project-local.sh --reset  throw it away and build it again
#   ./scripts/new-project-local.sh --stop    stop it, keeping the data
#
# Applies packages/db/new-project/V1 and V2, runs the seeds, creates one
# organisation and one user, and prints the connection string to put in .env.
#
# It does NOT touch your Supabase project, and it does not read it either --
# everything comes from files in this repository. The container keeps its data
# in a named docker volume between runs, so this is somewhere you can actually
# work rather than a throwaway.
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="bench-sales-new"
VOLUME="bench-sales-new-data"
PORT=54329
URL="postgresql://postgres:local@127.0.0.1:$PORT/benchsales"

ORG_NAME="${ORG_NAME:-Local Org}"
ORG_SLUG="${ORG_SLUG:-local-org}"
USER_EMAIL="${USER_EMAIL:-you@local.test}"
USER_NAME="${USER_NAME:-Local Admin}"

export PGCLIENTENCODING=UTF8

case "${1:-}" in
  --stop)
    docker stop "$CONTAINER" >/dev/null 2>&1 && echo "stopped (data kept in volume $VOLUME)" || echo "not running"
    exit 0 ;;
  --reset)
    echo "→ removing the container and its data"
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    docker volume rm "$VOLUME" >/dev/null 2>&1 || true ;;
esac

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    echo "→ starting the existing database"
    docker start "$CONTAINER" >/dev/null
  else
    echo "→ already running"
  fi
else
  echo "→ creating the database"
  docker volume create "$VOLUME" >/dev/null
  docker run -d --name "$CONTAINER" \
    -e POSTGRES_PASSWORD=local -e POSTGRES_DB=benchsales \
    -v "$VOLUME:/var/lib/postgresql/data" \
    -p "$PORT:5432" pgvector/pgvector:pg17 >/dev/null
fi

for _ in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -U postgres -d benchsales >/dev/null 2>&1 && break
  sleep 0.5
done
sleep 1

# Already built? Then this is just a restart, and re-applying would be noise.
BUILT="$(psql "$URL" -At -c "SELECT to_regclass('core.people') IS NOT NULL" 2>/dev/null || echo f)"

if [ "$BUILT" != "t" ]; then
  echo "→ applying the schema"
  psql "$URL" -v ON_ERROR_STOP=1 -q -f "$REPO/packages/db/new-project/V1__baseline.sql"
  psql "$URL" -v ON_ERROR_STOP=1 -q -f "$REPO/packages/db/new-project/V2__reference_data.sql"

  # Twice, on purpose.
  #
  # The files run in alphabetical order and that is not dependency order:
  # R__seed_graph_event_bindings comes before R__seed_syntra_graphs, so on the
  # first pass it can only bind the workflows that already exist and silently
  # skips the nine that do not. They are repeatable migrations -- idempotent by
  # design -- so a second pass costs nothing and settles the ordering.
  #
  # A seed that fails on BOTH passes is reported. Several target legacy tables
  # this structure does not have (channels, skills, public.matching_policies),
  # and those are expected to fail here.
  for pass in 1 2; do
    echo "→ seeding (pass $pass)"
    for f in "$REPO"/packages/db/migrations/R__seed_*.sql; do
      if ! psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>&1; then
        [ "$pass" = 2 ] && echo "   not applied: $(basename "$f")"
      fi
    done
  done

  echo "→ creating one organisation and one user"
  psql "$URL" -v ON_ERROR_STOP=1 -q <<SQL
-- id has no default on either table: the application generates it, so a
-- caller that omits it gets a not-null violation rather than a uuid.
INSERT INTO platform.organizations (id, name, slug)
VALUES (gen_random_uuid(), '$ORG_NAME', '$ORG_SLUG')
  ON CONFLICT (slug) DO NOTHING;
INSERT INTO platform.users (id, email, full_name)
VALUES (gen_random_uuid(), '$USER_EMAIL', '$USER_NAME')
  ON CONFLICT (email) DO NOTHING;
INSERT INTO platform.org_members (org_id, user_id, role)
SELECT o.id, u.id, 'admin'
  FROM platform.organizations o, platform.users u
 WHERE o.slug = '$ORG_SLUG' AND u.email = '$USER_EMAIL'
  ON CONFLICT DO NOTHING;
SQL
fi

ORG_ID="$(psql "$URL" -At -c "SELECT id FROM platform.organizations WHERE slug = '$ORG_SLUG'")"

echo
psql "$URL" -q -c "
SELECT (SELECT count(*) FROM platform.applications)   AS applications,
       (SELECT count(*) FROM platform.queues)         AS queues,
       (SELECT count(*) FROM authoring.event_catalog) AS events,
       (SELECT count(*) FROM authoring.graphs)        AS workflows,
       (SELECT count(*) FROM authoring.event_bindings WHERE status='active') AS bindings,
       (SELECT count(*) FROM authoring.node_registry) AS nodes;"

cat <<EOF

The new structure is running locally.

  DATABASE_URL=$URL
  DATABASE_MIGRATOR_URL=$URL
  DATABASE_RELAY_URL=$URL
  ORCH_ORGANIZATION_ID=$ORG_ID

Put those four in .env — keep a copy of your Supabase values first, this is the
only thing that decides which database the stack talks to.

Then, once, against this database:

  npm run bootstrap:runtime -w @tekisho/worker    # pg-boss and the checkpointer
  npm run materialize:nodes -w @tekisho/worker    # node registry, from the contracts

And start it:

  npm run dev:full

  ./scripts/new-project-local.sh --stop    stop, keep the data
  ./scripts/new-project-local.sh --reset   start over from empty
EOF
