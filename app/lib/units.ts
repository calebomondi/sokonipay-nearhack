/** sUSD has 6 decimals. Amounts are integers in micro-units everywhere except at the UI edge. */
export const MICRO = 1_000_000;
export const toMicro = (usd: number) => Math.round(usd * MICRO);
export const fmt = (micro: number | string | bigint) => {
  const n = Number(micro) / MICRO;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
