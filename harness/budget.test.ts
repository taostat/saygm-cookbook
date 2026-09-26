import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAP_NDOLLARS,
  costNdollars,
  formatUsd,
  isOverCap,
  parseUsdToNdollars,
} from "#harness/budget.ts";

const rates = {
  input: 1_000_000_000,
  output: 5_000_000_000,
  cache_read: 100_000_000,
  cache_write: 2_000_000_000,
};
const usage = {
  model: "m",
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

describe("parseUsdToNdollars", () => {
  it("parses dollar amounts to integer nano-dollars", () => {
    expect(parseUsdToNdollars("0.50")).toBe(500_000_000n);
    expect(parseUsdToNdollars("1")).toBe(1_000_000_000n);
    expect(parseUsdToNdollars("0.000000001")).toBe(1n);
    expect(parseUsdToNdollars(" 2.5 ")).toBe(2_500_000_000n);
  });

  it("rejects values it cannot represent exactly", () => {
    for (const bad of ["", "abc", "-1", "0.0000000001", "1e3", "1.", ".5", "0x10", "NaN"]) {
      expect(() => parseUsdToNdollars(bad)).toThrow(`"${bad}" is not a dollar amount`);
    }
  });

  it("defaults the cap to fifty cents", () => {
    expect(DEFAULT_CAP_NDOLLARS).toBe(500_000_000n);
  });
});

describe("costNdollars", () => {
  it("prices each token class at its per-million rate", () => {
    const cost = costNdollars(
      {
        ...usage,
        input_tokens: 1_000_000,
        output_tokens: 2_000_000,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 1,
      },
      rates,
    );
    expect(cost).toBe(1_000_000_000n + 10_000_000_000n + 1_000n + 2_000n);
  });

  it("rounds each class up so the cap is never under-counted", () => {
    expect(costNdollars({ ...usage, input_tokens: 1 }, { ...rates, input: 1 })).toBe(1n);
    expect(costNdollars({ ...usage, output_tokens: 3 }, { ...rates, output: 1_000_000 })).toBe(3n);
  });

  it("is zero for zero usage", () => {
    expect(costNdollars(usage, rates)).toBe(0n);
  });
});

describe("isOverCap", () => {
  it("allows spend exactly at the cap and fails one nano-dollar past it", () => {
    expect(isOverCap(500_000_000n, 500_000_000n)).toBe(false);
    expect(isOverCap(500_000_001n, 500_000_000n)).toBe(true);
    expect(isOverCap(0n, 0n)).toBe(false);
  });
});

describe("formatUsd", () => {
  it("prints dollars with six decimals, rounded up", () => {
    expect(formatUsd(500_000_000n)).toBe("$0.500000");
    expect(formatUsd(1n)).toBe("$0.000001");
    expect(formatUsd(0n)).toBe("$0.000000");
    expect(formatUsd(12_345_678_901n)).toBe("$12.345679");
  });
});
