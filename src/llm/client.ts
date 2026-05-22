import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

// ── Constants ────────────────────────────────────────────────────────

const SONNET_MODEL = "claude-sonnet-4-6";
const HAIKU_MODEL = "claude-haiku-4-5";
// Note: If deprecation warnings appear, update to latest model IDs from
// https://docs.anthropic.com/en/docs/about-claude/models

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

// ── Lazy Client ──────────────────────────────────────────────────────

let _client: Anthropic | undefined;

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Export it in your environment or add it to .env",
      );
    }
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

// ── Public Interface ─────────────────────────────────────────────────

export interface LlmCallOptions {
  maxTokens?: number;
  temperature?: number;
}

/**
 * Call Claude Sonnet with a structured JSON response validated against a Zod schema.
 */
export async function callSonnet<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodType<T>,
  options?: LlmCallOptions,
): Promise<T> {
  return callModel(SONNET_MODEL, systemPrompt, userPrompt, schema, options);
}

/**
 * Call Claude Haiku with a structured JSON response validated against a Zod schema.
 */
export async function callHaiku<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodType<T>,
  options?: LlmCallOptions,
): Promise<T> {
  return callModel(HAIKU_MODEL, systemPrompt, userPrompt, schema, options);
}

// ── Internal ─────────────────────────────────────────────────────────

async function callModel<T>(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodType<T>,
  options?: LlmCallOptions,
): Promise<T> {
  const maxTokens = options?.maxTokens ?? 16384;
  const temperature = options?.temperature ?? 0;

  let lastError: unknown;

  // Retry loop for network / rate-limit errors
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const text = await rawCall(model, systemPrompt, userPrompt, maxTokens, temperature);
      return validateJson(text, schema);
    } catch (err) {
      if (isValidationError(err)) {
        // Validation failed — retry once with a stricter prompt
        return retryWithStricterPrompt(model, systemPrompt, userPrompt, schema, maxTokens, temperature, err);
      }

      // Network / rate-limit — exponential backoff
      lastError = err;
      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }

  throw new Error(
    `LLM call failed after ${MAX_RETRIES} retries: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function rawCall(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  temperature: number,
): Promise<string> {
  const client = getClient();
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text block in LLM response");
  }

  // Check if output was truncated
  if (response.stop_reason === "max_tokens") {
    process.stderr.write(`  ⚠ LLM output truncated (${maxTokens} max_tokens). Increasing...\n`);
    // Retry with doubled limit
    if (maxTokens < 65536) {
      return rawCall(model, systemPrompt, userPrompt, maxTokens * 2, temperature);
    }
    throw new Error(`LLM output truncated even at ${maxTokens} max_tokens`);
  }

  return textBlock.text;
}

function validateJson<T>(text: string, schema: z.ZodType<T>): T {
  // Strip markdown code fences if present
  const cleaned = text
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    process.stderr.write(`  ⚠ JSON parse failed. Response length: ${cleaned.length} chars. First 50 chars: "${cleaned.slice(0, 50)}". Last 100 chars: "${cleaned.slice(-100)}"\n`);
    // Try to find and extract JSON object from the response
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
        const result = schema.safeParse(parsed);
        if (result.success) return result.data;
      } catch { /* fall through to error */ }
    }
    throw new ValidationError(`LLM returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new ValidationError(
      `Zod validation failed: ${JSON.stringify(result.error.issues ?? result.error, null, 2).slice(0, 500)}`,
    );
  }
  return result.data;
}

async function retryWithStricterPrompt<T>(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodType<T>,
  maxTokens: number,
  temperature: number,
  originalError: ValidationError,
): Promise<T> {
  const stricterUser = [
    userPrompt,
    "",
    "IMPORTANT: Your previous response was not valid JSON or did not match the required schema.",
    `Error: ${originalError.message}`,
    "",
    "Please respond with ONLY valid JSON (no markdown fences, no explanation). Ensure every required field is present and has the correct type.",
  ].join("\n");

  try {
    const text = await rawCall(model, systemPrompt, stricterUser, maxTokens, temperature);
    return validateJson(text, schema);
  } catch (retryErr) {
    throw new Error(
      `LLM validation failed after retry. Original: ${originalError.message}. Retry: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
    );
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

class ValidationError extends Error {
  readonly isValidation = true;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function isValidationError(err: unknown): err is ValidationError {
  return err instanceof ValidationError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
