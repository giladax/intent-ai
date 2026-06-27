import type { Organism } from "../eval/chromosomes/types.js";
import { scorer } from "../eval/chromosomes/chr1-instructions.js";
import { hybrid } from "../eval/chromosomes/chr2-formats.js";
import { fullPrecompute } from "../eval/chromosomes/chr3-synthesis.js";
import { conversationOnly } from "../eval/chromosomes/chr4-data.js";

/**
 * The production default moment-detection organism.
 *
 * This is the winning chromosome combination from the Gen 0 fitness eval —
 * {1b scorer, 2f hybrid, 3c full pre-compute, 4a conversation-only} — promoted
 * from the eval harness to the live pipeline so digestion uses the configuration
 * that scored best on the design-scope fixture.
 *
 *  - 1b scorer            — simplified two-task instruction prompt
 *  - 2f hybrid            — behavioral headers + full uncompressed event detail
 *  - 3c full pre-compute  — Haiku-powered exchange pre-classification
 *  - 4a conversation-only — moment detection sees the dialogue, not tool noise
 */
export const DEFAULT_ORGANISM: Organism = {
  name: "default (1b/2f/3c/4a)",
  instructions: scorer,
  format: hybrid,
  synthesis: fullPrecompute,
  dataSelection: conversationOnly,
};
