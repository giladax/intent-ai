import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getClient } from "./src/storage/connection.js";
import {
  scoreProvenance, scoreCalibration, scoreTail, scoreRecall, scorePrecision, scoreAgency,
  type MomentFidelityRow,
} from "./src/eval/fidelity.js";
import { fidelityCriteria } from "./tests/eval/fidelity-criteria.js";

function resolveRawLog(c: { rawLogPath: string; ccSessionId: string }): string | null {
  const archive = path.resolve(c.rawLogPath);
  if (fs.existsSync(archive)) return archive;
  const cc = path.join(os.homedir(), ".claude", "projects", "-Users-giladkoch-dev-intent-ai", `${c.ccSessionId}.jsonl`);
  return fs.existsSync(cc) ? cc : null;
}

function rawLastEventAt(logPath: string): Date | null {
  const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const d = JSON.parse(lines[i]);
      // skip trailing system-only noise (F8 report: 581def3d case)
      if (d.timestamp && d.type !== "system") return new Date(d.timestamp);
    } catch { /* skip */ }
  }
  return null;
}

const sql = getClient();
for (const c of fidelityCriteria) {
  const sess = await sql`SELECT id, ended_at FROM sessions WHERE source_hash = ${c.ccSessionId} LIMIT 1`;
  if (sess.length === 0) { console.log(`\n## ${c.label}\n  NOT DIGESTED — skipping`); continue; }
  const sessionId = sess[0].id as string;

  const momentRows = await sql`
    SELECT m.id, m.statement, m.type, m.agency, m.confidence, m.occurred_at, c2.chunk_index
    FROM moments m LEFT JOIN chunks c2 ON m.chunk_id = c2.id
    WHERE m.session_id = ${sessionId}`;
  const evidence = await sql`
    SELECT me.moment_id, me.quote, me.source_event_id FROM moment_evidence me
    JOIN moments m ON me.moment_id = m.id WHERE m.session_id = ${sessionId}`;
  const narr = await sql`SELECT summary, progression, discoveries FROM narratives WHERE session_id = ${sessionId} LIMIT 1`;
  const tConf = await sql`SELECT confidence FROM transitions WHERE session_id = ${sessionId}`;
  const oConf = await sql`SELECT confidence FROM outcomes WHERE session_id = ${sessionId}`;

  const moments: MomentFidelityRow[] = momentRows.map((m) => {
    const ev = evidence.filter((e) => e.moment_id === m.id);
    return {
      statement: m.statement as string, type: m.type as string,
      agency: (m.agency as string) ?? null, confidence: (m.confidence as string) ?? null,
      chunkIndex: (m.chunk_index as number) ?? null,
      occurredAt: m.occurred_at ? new Date(m.occurred_at as string) : null,
      evidenceQuotes: ev.map((e) => e.quote as string),
      anchoredEvidenceCount: ev.filter((e) => e.source_event_id != null).length,
    };
  });

  const narrativeText = narr.length
    ? [narr[0].summary, ...(narr[0].progression ?? []), ...(narr[0].discoveries ?? [])].join(" ")
    : "";
  const logPath = resolveRawLog(c);

  const prov = scoreProvenance(moments);
  const momentCal = scoreCalibration(moments.map((m) => m.confidence));
  const toCal = scoreCalibration([...tConf, ...oConf].map((r) => (r.confidence as string) ?? null));
  const tail = scoreTail(sess[0].ended_at ? new Date(sess[0].ended_at as string) : null, logPath ? rawLastEventAt(logPath) : null);
  const statements = moments.map((m) => m.statement);
  const recall = scoreRecall(c.expectedMoments, statements, narrativeText);
  const precision = scorePrecision(c.forbiddenClaims, statements, narrativeText);
  const agency = scoreAgency(c.expectedMoments, moments);

  const logNote = logPath ? "" : ` (raw log NOT FOUND — tail score unreliable)`;
  console.log(`\n## ${c.label} (${c.ccSessionId.slice(0, 8)})${logNote}`);
  console.log(`  provenance: evidenceReal ${prov.evidenceRealPct}% | anchored ${prov.evidenceAnchoredPct}% | chunks ${prov.distinctChunks} (${prov.chunkSpreadOk ? "ok" : "DEGENERATE"}) | occurredSpan ${prov.occurredTimeSpanMs == null ? "none" : Math.round(prov.occurredTimeSpanMs / 60000) + "min"}`);
  console.log(`  calibration: moments ${JSON.stringify(momentCal.distribution)} ${momentCal.informative ? "" : "UNINFORMATIVE"} | transitions+outcomes ${JSON.stringify(toCal.distribution)} ${toCal.informative ? "" : "UNINFORMATIVE"}`);
  console.log(`  tail: ${tail.covered ? "covered" : `LOST ${Math.round(tail.lostMs / 60000)}min`}`);
  console.log(`  recall: ${recall.matched}/${recall.expected}${recall.missed.length ? " missed: " + recall.missed.join("; ") : ""}`);
  console.log(`  precision violations: ${precision.violations.length ? precision.violations.join("; ") : "none"}`);
  console.log(`  agency: ${agency.correct}/${agency.checked}${agency.wrong.length ? " wrong: " + agency.wrong.join("; ") : ""}`);
}
await sql.end();
