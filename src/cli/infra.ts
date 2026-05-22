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

  // Give Postgres a moment to accept connections
  console.log("Waiting for Postgres to be ready...");
  run(
    `until docker compose exec db pg_isready -U intent > /dev/null 2>&1; do sleep 0.5; done`,
  );

  console.log("Running migrations...");
  run("npx drizzle-kit migrate");

  console.log("Database is up and migrated.");
}

export function down(): void {
  console.log("Stopping database...");
  run("docker compose down");
  console.log("Database stopped.");
}
