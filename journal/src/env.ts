// Load .env for the journal app. Credentials live in the repo-root .env
// (shared with alignment/); a journal-local .env wins if present.
import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// quiet: dotenv v17 logs to stdout by default, which corrupts the MCP
// stdio transport when this loads under `cli mcp`.
config({ quiet: true }); // cwd (normally journal/)
config({ path: join(here, "..", ".env"), quiet: true }); // journal/.env
config({ path: join(here, "..", "..", ".env"), quiet: true }); // repo root .env
