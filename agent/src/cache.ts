import {createHash} from "node:crypto";
import {existsSync, readFileSync, writeFileSync} from "node:fs";

import type {Assessment, Load, Mandate} from "./types";

/**
 * ASSESSMENT CACHE.
 *
 * A grade is a function of what the model was shown. Re-asking for the same
 * grade on the same load every twenty seconds is not diligence, it is a bill -
 * and worse, it invites the same inputs to come back with a different answer,
 * which is exactly the non-determinism the pricing split was built to keep out
 * of the capital path.
 *
 * So a load is graded once per book and the answer is kept. Change the face
 * value, the obligor, the term, the document, the mandate, or the model, and
 * the key changes and it is graded again. Nothing else re-grades.
 *
 * That is what makes an unattended loop affordable: a demo with one receivable
 * and three books costs three model calls in total, not three per sweep.
 *
 * Persisted to disk so a restart does not re-spend, and readable on purpose -
 * it doubles as the record of what each agent thought and when.
 */

const FILE = process.env.ASSESSMENT_CACHE ?? "assessments.json";

interface Entry extends Assessment {
  key: string;
  book: string;
  assetId: string;
  model: string;
  at: string;
}

type Store = Record<string, Entry>;

let store: Store | null = null;

function load(): Store {
  if (store) return store;
  try {
    store = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as Store) : {};
  } catch {
    // A corrupt cache is not worth failing a run over; regrading is always safe.
    store = {};
  }
  return store;
}

/**
 * Everything the judgment layer is shown, and nothing it is not.
 *
 * Deliberately excludes anything that moves on its own - the standing floor,
 * the block number, the premium reserve. Those change constantly and none of
 * them is an input to a credit grade, so including them would silently defeat
 * the cache and put the model back in the loop on every sweep.
 */
export function keyFor(load: Load, mandate: Mandate, model: string): string {
  return createHash("sha256")
    .update(
      [
        load.docHash,
        load.debtor.toLowerCase(),
        load.faceValue.toString(),
        load.dueDate.toString(),
        mandate.name,
        mandate.bias,
        mandate.refuses.join(","),
        mandate.ceiling.toString(),
        model,
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 32);
}

export function get(key: string): Assessment | null {
  const hit = load()[key];
  if (!hit) return null;
  return {grade: hit.grade, rationale: hit.rationale, source: hit.source};
}

export function put(
  key: string,
  assessment: Assessment,
  meta: {book: string; assetId: bigint; model: string},
): void {
  const s = load();
  s[key] = {
    key,
    ...assessment,
    book: meta.book,
    assetId: meta.assetId.toString(),
    model: meta.model,
    at: new Date().toISOString(),
  };
  try {
    writeFileSync(FILE, JSON.stringify(s, null, 2));
  } catch {
    // Losing the write costs a re-grade, never correctness.
  }
}

export function size(): number {
  return Object.keys(load()).length;
}

/** Testing seam: drop the in-memory copy so a fresh file is read. */
export function _reset(): void {
  store = null;
}
