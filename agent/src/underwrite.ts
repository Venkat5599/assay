import OpenAI from "openai";

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
 * With credentials present the grade comes from the model reading the load.
 * Without them the same inputs run through the rubric below. Every proposal
 * records which path produced it in `source`, so the provenance of a number
 * that is about to move real capital is never ambiguous.
 */

const DAY = 86_400n;
const PLACEHOLDER_OBLIGOR = "0x000000000000000000000000000000000000dEaD";

export const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

/**
 * Structured output schema. The model fills exactly this and nothing else -
 * no prose to parse, no JSON to repair, and notably no price field, because
 * the model is not permitted to set one.
 */
const SCHEMA = {
  type: "object",
  properties: {
    grade: {type: "string", enum: ["A", "B", "C", "D", "REJECT"]},
    rationale: {type: "string"},
  },
  required: ["grade", "rationale"],
  additionalProperties: false,
} as const;

/** Instantiated lazily so the module imports cleanly with no credentials. */
let client: OpenAI | null = null;
function openai(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      // Gateways and proxies are common for keys issued outside OpenAI itself.
      baseURL: process.env.OPENAI_BASE_URL,
    });
  }
  return client;
}

const facts = (load: Load, mandate: Mandate) => {
  const face = Number(load.faceValue) / 10 ** DECIMALS;
  const daysOut = Number((load.dueDate - BigInt(Math.floor(Date.now() / 1000))) / DAY);
  return {face, daysOut, mandate};
};

export async function assess(load: Load, mandate: Mandate): Promise<Assessment> {
  if (process.env.OPENAI_API_KEY) {
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
  const {face, daysOut} = facts(load, mandate);

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
  const {face, daysOut} = facts(load, mandate);

  const response = await openai().chat.completions.create({
    model: MODEL,
    max_completion_tokens: 512,
    messages: [
      {
        role: "system",
        content: [
          "You are a freight receivables underwriter with your own capital at risk.",
          "You are committing to BUY this invoice at a price derived from your grade,",
          "so a generous grade costs you money whenever it is wrong.",
          "Grade the credit only. Never state, imply, or reason toward a price.",
          "Keep the rationale to one sentence a carrier would understand.",
        ].join(" "),
      },
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
    response_format: {
      type: "json_schema",
      json_schema: {name: "assessment", strict: true, schema: SCHEMA},
    },
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error("model returned no content");

  const parsed = JSON.parse(raw) as {grade: Grade; rationale: string};
  if (!parsed.grade || !parsed.rationale) throw new Error("model returned an incomplete assessment");

  return {grade: parsed.grade, rationale: parsed.rationale, source: "model"};
}
