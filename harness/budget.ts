export const NDOLLARS_PER_USD = 1_000_000_000n;
export const DEFAULT_CAP_NDOLLARS = 500_000_000n;
const TOKENS_PER_MTOK = 1_000_000n;

export interface Usage {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface Rates {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

export function parseUsdToNdollars(text: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,9}))?$/.exec(text.trim());
  if (match === null) {
    throw new Error(`"${text}" is not a dollar amount; use a plain decimal such as 0.50`);
  }
  const [, whole = "0", fraction = ""] = match;
  return BigInt(whole) * NDOLLARS_PER_USD + BigInt(fraction.padEnd(9, "0"));
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function classCost(tokens: number, ratePerMtok: number): bigint {
  return ceilDiv(BigInt(tokens) * BigInt(ratePerMtok), TOKENS_PER_MTOK);
}

export function costNdollars(usage: Usage, rates: Rates): bigint {
  return (
    classCost(usage.input_tokens, rates.input) +
    classCost(usage.output_tokens, rates.output) +
    classCost(usage.cache_read_input_tokens, rates.cache_read) +
    classCost(usage.cache_creation_input_tokens, rates.cache_write)
  );
}

export function isOverCap(totalNdollars: bigint, capNdollars: bigint): boolean {
  return totalNdollars > capNdollars;
}

export function formatUsd(ndollars: bigint): string {
  const micro = ceilDiv(ndollars, 1_000n);
  const whole = micro / 1_000_000n;
  const fraction = (micro % 1_000_000n).toString().padStart(6, "0");
  return `$${whole}.${fraction}`;
}
