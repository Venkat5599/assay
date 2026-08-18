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
 * With ANTHROPIC_API_KEY set the grade comes from Claude reading the load.
 * Without it the same inputs run through the rubric below. Every bid records
 * which path produced it in `source`, so the provenance is never ambiguous.
 */

const DAY = 86_400n;
const PLACEHOLDER_OBLIGOR = "0x000000000000000000000000000000000000dEaD";

export async function assess(load: Load, mandate: Mandate): Promise<Assessment> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    try {
      return await assessWithModel(load, mandate, key);
    } catch (err) {
      console.warn(`  model unavailable, using rubric: ${(err as Error).message}`);
    }
  }
  return assessWithRubric(load, mandate);
}

/** Deterministic, replayable, and the documented default. */
export function assessWithRubric(load: Load, mandate: Mandate): Assessment {
  const face = Number(load.faceValue / 10n ** 18n);
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

async function assessWithModel(
  load: Load,
  mandate: Mandate,
  apiKey: string,
): Promise<Assessment> {
  const face = Number(load.faceValue / 10n ** 18n);
  const daysOut = Number((load.dueDate - BigInt(Math.floor(Date.now() / 1000))) / DAY);

  const system = [
    "You are a freight receivables underwriter.",
    "You are committing your own capital to BUY this invoice at a price you set,",
    "so a generous grade costs you money when it is wrong.",
    'Reply with strict JSON only: {"grade":"A|B|C|D|REJECT","rationale":"one sentence under 160 characters"}.',
    "Grade the credit. Never state a price.",
  ].join(" ");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 300,
      system,
      messages: [
        {
          role: "user",
          content: [
            `Book mandate: ${mandate.bias}`,
            `Face value: ${face} USD`,
            `Days to settlement: ${daysOut}`,
            `Obligor: ${load.debtor}`,
            `Document hash: ${load.docHash}`,
          ].join("\n"),
        },
      ],
    }),
  });

  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const body = (await res.json()) as {content: {text: string}[]};
  const parsed = JSON.parse(body.content[0]!.text) as {grade: Grade; rationale: string};
  return {grade: parsed.grade, rationale: parsed.rationale, source: "model"};
}
