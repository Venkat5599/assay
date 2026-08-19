import Anthropic from "@anthropic-ai/sdk";
import {formatUnits} from "viem";
import {zodOutputFormat} from "@anthropic-ai/sdk/helpers/zod";
import {z} from "zod";

import {DECIMALS} from "./chain";
import type {Assessment, Grade, Load, Mandate} from "./types";

/**
 * THE JUDGMENT LAYER.
 *
 * Returns a risk GRADE and a written rationale. It never returns a price.
 *
 * That split is the design. A model that emits a number directly is
 * unauditable: you cannot replay it, you cannot unit-test it, and you cannot
 * tell a carrier why their invoice was marked down. A model that emits a
 * graded rationale, converted to a price by arithmetic anyone can read, is
 * defensible on all three counts.
 *
 * With credentials present the grade comes from Claude reading the load.
 * Without them the same inputs run through the rubric below. Every bid records
 * which path produced it in `source`, so the provenance of a number that moved
 * real capital is never ambiguous.
 */

const DAY = 86_400n;
const PLACEHOLDER_OBLIGOR = "0x000000000000000000000000000000000000dEaD";

/**
 * Structured output schema. The model fills exactly this and nothing else -
 * no prose to parse, no JSON to repair, and notably no price field, because
 * the model is not permitted to set one.
 */
const AssessmentSchema = z.object({
  grade: z.enum(["A", "B", "C", "D", "REJECT"]),
  rationale: z.string(),
});

/** Instantiated lazily so the module imports cleanly with no credentials. */
let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export async function assess(load: Load, mandate: Mandate): Promise<Assessment> {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
    try {
      return await assessWithModel(load, mandate);
    } catch (err) {
      console.warn(`  model unavailable, using rubric: ${(err as Error).message}`);
    }
  }
  return assessWithRubric(load, mandate);
}

/** Deterministic, replayable, and the documented fallback. */
export function assessWithRubric(load: Load, mandate: Mandate): Assessment {
  const face = Number(formatUnits(load.faceValue, DECIMALS));
  const daysOut = Number((load.dueDate - BigInt(Math.floor(Date.now() / 1000))) / DAY);

  const reasons: string[] = [];
  let score = 100;

  if (daysOut > 75) {
    score -= 22;
    reasons.push(`${daysOut}-day tail is long for a single-obligor receivable`);
  } else if (daysOut > 45) {
    score -= 10;
    reasons.push(`${daysOut} days to settlement`);
  } else {
    reasons.push(`short ${daysOut}-day tail`);
  }

  if (face > mandate.ceiling) {
    score -= 40;
    reasons.push(`face value ${face.toLocaleString()} sits past this book's ceiling`);
  } else if (face > mandate.ceiling * 0.5) {
    score -= 12;
    reasons.push("sizeable relative to the book");
  } else {
    reasons.push("comfortable size");
  }

  if (load.debtor.toLowerCase() === PLACEHOLDER_OBLIGOR.toLowerCase()) {
    score -= 6;
    reasons.push("obligor is a placeholder");
  }

  const grade: Grade =
    score >= 88 ? "A" : score >= 74 ? "B" : score >= 58 ? "C" : score >= 40 ? "D" : "REJECT";

  return {grade, rationale: `${mandate.bias}; ${reasons.join("; ")}.`, source: "rubric"};
}

async function assessWithModel(load: Load, mandate: Mandate): Promise<Assessment> {
  const face = Number(formatUnits(load.faceValue, DECIMALS));
  const daysOut = Number((load.dueDate - BigInt(Math.floor(Date.now() / 1000))) / DAY);

  const response = await anthropic().messages.parse({
    model: "claude-opus-5",
    max_tokens: 2048,
    system: [
      "You are a freight receivables underwriter with your own capital at risk.",
      "You are committing to BUY this invoice at a price derived from your grade,",
      "so a generous grade costs you money whenever it is wrong.",
      "Grade the credit only. Never state, imply, or reason toward a price.",
      "Keep the rationale to one sentence a carrier would understand.",
    ].join(" "),
    messages: [
      {
        role: "user",
        content: [
          `Book mandate: ${mandate.bias}.`,
          `This book refuses grades: ${mandate.refuses.join(", ") || "none"}.`,
          `Face value: ${face} USD`,
          `Days to settlement: ${daysOut}`,
          `Obligor address: ${load.debtor}`,
          `Document hash: ${load.docHash}`,
        ].join("\n"),
      },
    ],
    output_config: {format: zodOutputFormat(AssessmentSchema)},
  });

  const parsed = response.parsed_output;
  if (!parsed) throw new Error("model returned no parseable assessment");

  return {grade: parsed.grade, rationale: parsed.rationale, source: "model"};
}
