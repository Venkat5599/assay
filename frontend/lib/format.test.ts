import {describe, expect, test} from "vitest";
import {parseUnits} from "viem";

import {DECIMALS, bolRef, fromUnits, shortAddress, toUnits, usd} from "./format";
import {ACTIVE, DEPLOYMENTS} from "./networks";

/**
 * Formatting is where the settlement asset's precision either holds or quietly
 * breaks the whole product.
 *
 * LADING settles in bridged USDT at SIX decimals. The entire frontend assumed
 * eighteen for most of this project's life, which does not throw - it renders
 * every figure a million times too large and lets a carrier read a credit line
 * that does not exist. These tests exist so that regression cannot come back
 * silently.
 */

describe("decimals", () => {
  /*
    This asserted a flat 6, which was true only while mainnet was the default
    deployment. Switching the default to testnet - which settles in an
    18-decimal token this project mints - turned a correct reading into a
    failing test, and hardcoding the other number would just move the same bug.

    The invariant was never "six". It is that precision is READ from the
    deployment in force and never assumed, so both of these pin that instead.
  */
  test("is taken from the deployment in force, never assumed", () => {
    expect(DECIMALS).toBe(ACTIVE.decimals);
  });

  test("each deployment carries the precision its own settlement token has", () => {
    expect(DEPLOYMENTS.mainnet.decimals).toBe(6);
    expect(DEPLOYMENTS.testnet.decimals).toBe(18);
  });

  test("round-trips a human amount through token units", () => {
    for (const v of ["1", "0.5", "18400", "12345.67", "250000"]) {
      expect(fromUnits(toUnits(v))).toBe(String(Number(v)));
    }
  });

  test("toUnits agrees with viem at the configured precision", () => {
    expect(toUnits("18400")).toBe(parseUnits("18400", DECIMALS));
  });

  test("treats empty input as zero rather than NaN", () => {
    expect(toUnits("")).toBe(0n);
  });

  test("reading mainnet at eighteen decimals is a million times too large", () => {
    // The exact failure mode: same string, wrong precision, no error thrown.
    // Stated against mainnet's six explicitly, so it keeps testing the bug
    // whichever deployment happens to be the default.
    const mainnet = DEPLOYMENTS.mainnet.decimals;
    expect(parseUnits("18400", 18) / parseUnits("18400", mainnet)).toBe(10n ** 12n);
  });
});

describe("usd", () => {
  test("renders token units at settlement precision", () => {
    expect(usd(toUnits("18400"))).toBe("18,400");
  });

  test("keeps cents on small amounts and drops them on large", () => {
    expect(usd(toUnits("12.34"))).toBe("12.34");
    expect(usd(toUnits("1234.56"))).toBe("1,235");
  });

  test("undefined is not zero", () => {
    // A figure that has not loaded and a figure that is genuinely zero mean
    // very different things on a credit console.
    expect(usd(undefined)).toBe("--");
    expect(usd(0n)).toBe("0");
  });

  test("honours an explicit precision override", () => {
    expect(usd(parseUnits("42", 18), 18)).toBe("42");
  });
});

describe("bolRef", () => {
  test("is deterministic for a document hash", () => {
    const h = "0x20355c1e4181601bdeadbeef";
    expect(bolRef(h)).toBe(bolRef(h));
  });

  test("always renders the same shape", () => {
    for (const h of ["0x00000000", "0xffffffff", "0x20355c1e4181601b"]) {
      expect(bolRef(h)).toMatch(/^BOL-\d{5}$/);
    }
  });

  test("different documents give different references", () => {
    expect(bolRef("0xaaaaaaaa")).not.toBe(bolRef("0xbbbbbbbb"));
  });

  test("missing input does not fabricate a reference", () => {
    expect(bolRef(undefined)).toBe("--");
  });
});

describe("shortAddress", () => {
  test("keeps both ends so an address stays identifiable", () => {
    expect(shortAddress("0x20FCBBD388e2a1660E727697e0EF43eB4d9d3D24")).toBe("0x20FC…3D24");
  });

  test("missing input does not render a fake address", () => {
    expect(shortAddress(undefined)).toBe("--");
  });
});
