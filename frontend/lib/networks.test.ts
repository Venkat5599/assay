import {describe, expect, test} from "vitest";
import {isAddress} from "viem";

import {DEPLOYMENTS, type Deployment} from "./networks";

/**
 * The network table is configuration, which is exactly the kind of thing that
 * rots quietly. A wrong address renders an empty console rather than an error,
 * and a wrong `decimals` renders every figure off by orders of magnitude
 * without throwing anything at all.
 */

const all = Object.values(DEPLOYMENTS);

describe("deployments", () => {
  test("every address is a real address", () => {
    for (const d of all) {
      for (const [name, addr] of Object.entries(d.addresses)) {
        expect(isAddress(addr as string), `${d.key}.${name}`).toBe(true);
      }
    }
  });

  test("each deployment names all four core contracts", () => {
    for (const d of all) {
      for (const k of ["assetRegistry", "market", "vault", "stable"] as const) {
        expect(d.addresses[k], `${d.key}.${k}`).toBeDefined();
      }
    }
  });

  test("the two deployments share no contract addresses", () => {
    // Same address on both chains would mean the table was copied and not
    // edited - the failure would look like a working console pointed at a
    // contract that does not exist on the chain being read.
    const m = Object.values(DEPLOYMENTS.mainnet.addresses).map((a) => a!.toLowerCase());
    const t = Object.values(DEPLOYMENTS.testnet.addresses).map((a) => a!.toLowerCase());
    expect(m.filter((a) => t.includes(a))).toEqual([]);
  });

  test("settlement precision differs, and follows the token not the chain", () => {
    // Mainnet settles in bridged USDT at six decimals; testnet in a token this
    // project mints at eighteen. A toggle that moved addresses but not
    // precision is the whole reason this test exists.
    expect(DEPLOYMENTS.mainnet.decimals).toBe(6);
    expect(DEPLOYMENTS.testnet.decimals).toBe(18);
  });

  test("only the network whose token is mintable claims a faucet", () => {
    expect(DEPLOYMENTS.mainnet.mintable).toBe(false);
    expect(DEPLOYMENTS.testnet.mintable).toBe(true);
  });

  test("chain ids and keys line up", () => {
    expect(DEPLOYMENTS.mainnet.id).toBe(677);
    expect(DEPLOYMENTS.testnet.id).toBe(968);
    for (const [key, d] of Object.entries(DEPLOYMENTS)) {
      expect((d as Deployment).key).toBe(key);
    }
  });

  test("each points at its own explorer over https", () => {
    expect(DEPLOYMENTS.mainnet.explorer).not.toBe(DEPLOYMENTS.testnet.explorer);
    for (const d of all) {
      expect(d.explorer.startsWith("https://")).toBe(true);
      expect(d.rpc.startsWith("https://")).toBe(true);
      expect(d.explorer.endsWith("/")).toBe(false); // links concatenate a path
    }
  });
});
