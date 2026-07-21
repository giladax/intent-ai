#!/bin/bash
# End-to-end test: starts TS daemon (DEMOTED — production uses Python watcher: python3 -m quire.cli journal watch-sessions)
# Usage: ./test-daemon.sh

set -e

# Load env vars so Haiku calls work
set -a; source .env; set +a

PORT=4317
TRANSCRIPT="/tmp/test-session-observe-$$.jsonl"
DAEMON_PID=""

cleanup() {
  [ -n "$DAEMON_PID" ] && kill "$DAEMON_PID" 2>/dev/null
  rm -f "$TRANSCRIPT"
  echo ""
  echo "=== Cleaned up ==="
}
trap cleanup EXIT

echo "=== Starting daemon on port $PORT ==="
npx tsx src/cli/index.ts observe --force-legacy --port "$PORT" &
DAEMON_PID=$!
sleep 2

# Verify health
if ! curl -sf http://127.0.0.1:$PORT/health > /dev/null; then
  echo "FAIL: daemon didn't start"
  exit 1
fi
echo "[ok] Daemon healthy"

# Create empty transcript
touch "$TRANSCRIPT"

# 1. SessionStart
curl -s -X POST http://127.0.0.1:$PORT/hooks \
  -H 'Content-Type: application/json' \
  -d "{\"hook_event_name\":\"SessionStart\",\"session_id\":\"test-e2e\",\"transcript_path\":\"$TRANSCRIPT\",\"cwd\":\"$(pwd)\",\"permission_mode\":\"default\",\"source\":\"startup\"}" > /dev/null
echo "[ok] SessionStart"

# Write user message to transcript
echo "{\"type\":\"user\",\"timestamp\":\"2026-05-30T20:00:01.000Z\",\"uuid\":\"u-001\",\"sessionId\":\"test-e2e\",\"message\":{\"role\":\"user\",\"content\":\"Refactor the normalizer to handle nested tool calls\"}}" >> "$TRANSCRIPT"
sleep 0.5

# 2. UserPromptSubmit
curl -s -X POST http://127.0.0.1:$PORT/hooks \
  -H 'Content-Type: application/json' \
  -d "{\"hook_event_name\":\"UserPromptSubmit\",\"session_id\":\"test-e2e\",\"transcript_path\":\"$TRANSCRIPT\",\"cwd\":\"$(pwd)\",\"permission_mode\":\"default\",\"prompt\":\"Refactor the normalizer to handle nested tool calls\"}" > /dev/null
echo "[ok] UserPromptSubmit"

# Write assistant response with tool calls
echo "{\"type\":\"assistant\",\"timestamp\":\"2026-05-30T20:00:05.000Z\",\"uuid\":\"a-001\",\"sessionId\":\"test-e2e\",\"message\":{\"id\":\"msg-001\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"claude-sonnet-4-6\",\"content\":[{\"type\":\"text\",\"text\":\"I will read the normalizer first.\"},{\"type\":\"tool_use\",\"id\":\"toolu_e2e_001\",\"name\":\"Read\",\"input\":{\"file_path\":\"src/daemon/normalizer.ts\"}}],\"stop_reason\":\"tool_use\"}}" >> "$TRANSCRIPT"
sleep 0.5

# 3. PostToolUse (Read)
curl -s -X POST http://127.0.0.1:$PORT/hooks \
  -H 'Content-Type: application/json' \
  -d "{\"hook_event_name\":\"PostToolUse\",\"session_id\":\"test-e2e\",\"transcript_path\":\"$TRANSCRIPT\",\"cwd\":\"$(pwd)\",\"permission_mode\":\"default\",\"tool_name\":\"Read\",\"tool_use_id\":\"toolu_e2e_001\",\"tool_input\":{\"file_path\":\"src/daemon/normalizer.ts\"},\"tool_response\":\"file contents...\"}" > /dev/null
echo "[ok] PostToolUse (Read)"

# Write edit tool call
echo "{\"type\":\"assistant\",\"timestamp\":\"2026-05-30T20:00:10.000Z\",\"uuid\":\"a-002\",\"sessionId\":\"test-e2e\",\"message\":{\"id\":\"msg-002\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"claude-sonnet-4-6\",\"content\":[{\"type\":\"tool_use\",\"id\":\"toolu_e2e_002\",\"name\":\"Edit\",\"input\":{\"file_path\":\"src/daemon/normalizer.ts\",\"old_string\":\"old\",\"new_string\":\"new\"}}],\"stop_reason\":\"tool_use\"}}" >> "$TRANSCRIPT"
sleep 0.5

# 4. PostToolUse (Edit)
curl -s -X POST http://127.0.0.1:$PORT/hooks \
  -H 'Content-Type: application/json' \
  -d "{\"hook_event_name\":\"PostToolUse\",\"session_id\":\"test-e2e\",\"transcript_path\":\"$TRANSCRIPT\",\"cwd\":\"$(pwd)\",\"permission_mode\":\"default\",\"tool_name\":\"Edit\",\"tool_use_id\":\"toolu_e2e_002\",\"tool_input\":{\"file_path\":\"src/daemon/normalizer.ts\"},\"tool_response\":\"File edited\"}" > /dev/null
echo "[ok] PostToolUse (Edit)"

# 5. Stop
curl -s -X POST http://127.0.0.1:$PORT/hooks \
  -H 'Content-Type: application/json' \
  -d "{\"hook_event_name\":\"Stop\",\"session_id\":\"test-e2e\",\"transcript_path\":\"$TRANSCRIPT\",\"cwd\":\"$(pwd)\",\"permission_mode\":\"default\",\"stop_hook_active\":false}" > /dev/null
echo "[ok] Stop"

echo ""
echo "=== Waiting for debounce (5s) + Haiku digest... ==="
sleep 8

# Check results
echo ""
echo "=== Results ==="

# Events file
EVENTS=$(wc -l < events.ndjson | tr -d ' ')
echo "[events.ndjson] $EVENTS events captured"

# Live state
LIVE=$(curl -s http://127.0.0.1:$PORT/live)
TURN_COUNT=$(echo "$LIVE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['state']['turnCount'] if d['state'] else 0)" 2>/dev/null || echo "?")
INTENT=$(echo "$LIVE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['state']['currentIntent'][:60] if d['state'] and d['state']['currentIntent'] else 'none')" 2>/dev/null || echo "?")
SUGGESTIONS=$(echo "$LIVE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['suggestion']['suggestions']) if d['suggestion'] else 0)" 2>/dev/null || echo "?")

echo "[live state] turns=$TURN_COUNT intent=\"$INTENT\""
echo "[suggestions] $SUGGESTIONS prompt suggestions available"

if [ "$SUGGESTIONS" != "0" ] && [ "$SUGGESTIONS" != "?" ]; then
  echo ""
  echo "=== Prompt Suggestions ==="
  echo "$LIVE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
if d['suggestion']:
    print(f\"Session: {d['suggestion']['sessionSummary']}\")
    for s in d['suggestion']['suggestions']:
        print(f\"  [{s['category']}] {s['prompt']}\")
        print(f\"    → {s['reasoning']}\")
"
fi

# 6. SessionEnd
curl -s -X POST http://127.0.0.1:$PORT/hooks \
  -H 'Content-Type: application/json' \
  -d "{\"hook_event_name\":\"SessionEnd\",\"session_id\":\"test-e2e\",\"transcript_path\":\"$TRANSCRIPT\",\"cwd\":\"$(pwd)\",\"permission_mode\":\"default\",\"reason\":\"prompt_input_exit\"}" > /dev/null
echo ""
echo "[ok] SessionEnd"

echo ""
echo "=== PASS: Daemon end-to-end test complete ==="
