import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..", "..");

function run(cmd: string): void {
  execSync(cmd, { cwd: projectRoot, stdio: "inherit" });
}

export function up(): void {
  console.log("Starting database...");
  run("docker compose up -d");

  // Give Postgres a moment to accept connections. Bounded wait — give up
  // after ~30s (60 attempts × 0.5s) instead of hanging forever when the
  // container never becomes healthy.
  console.log("Waiting for Postgres to be ready...");
  const maxAttempts = 60;
  run(
    `i=0; until docker compose exec db pg_isready -U intent > /dev/null 2>&1; do ` +
      `i=$((i+1)); ` +
      `if [ "$i" -ge ${maxAttempts} ]; then ` +
      `echo "Postgres did not become ready after ${maxAttempts} attempts (~30s)." >&2; exit 1; ` +
      `fi; ` +
      `sleep 0.5; done`,
  );

  console.log("Running migrations...");
  run("npx drizzle-kit migrate");

  // Startup guard: ensure feed_cache table exists even if the migration was
  // added after the DB was first initialised (covers installs that skipped 0004).
  run(
    `docker compose exec -T db psql -U intent -d intent -c ` +
    `"CREATE TABLE IF NOT EXISTS feed_cache (` +
    `id text PRIMARY KEY, ` +
    `payload jsonb NOT NULL, ` +
    `composed_at timestamptz NOT NULL, ` +
    `event_count_at_compose integer NOT NULL DEFAULT 0` +
    `);" 2>/dev/null || true`,
  );

  console.log("Database is up and migrated.");
}

export function down(): void {
  console.log("Stopping database...");
  run("docker compose down");
  console.log("Database stopped.");
}
