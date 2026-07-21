// Load .env for the journal app. Credentials live in the repo-root .env
// (shared with alignment/); a journal-local .env wins if present.
import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
config(); // cwd (normally journal/)
config({ path: join(here, "..", ".env") }); // journal/.env
config({ path: join(here, "..", "..", ".env") }); // repo root .env
