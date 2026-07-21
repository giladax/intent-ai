import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://intent:intent@localhost:5433/intent";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _client: ReturnType<typeof postgres> | null = null;

export function getDb() {
  if (!_db) {
    _client = postgres(DATABASE_URL);
    _db = drizzle(_client, { schema });
  }
  return _db;
}

export function getClient() {
  if (!_client) {
    getDb();
  }
  return _client!;
}

export async function closeDb() {
  if (_client) {
    await _client.end();
    _client = null;
    _db = null;
  }
}
