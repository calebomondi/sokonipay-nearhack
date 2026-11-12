export const NETWORK = "testnet";
export const CONTRACT = process.env.NEXT_PUBLIC_SOKONIPAY_CONTRACT || "sokonipay.testnet";
export const TOKEN = process.env.NEXT_PUBLIC_SUSD_TOKEN || `susd.${CONTRACT}`;
export const EXPLORER_TX = "https://testnet.nearblocks.io/txns/";
export const EXPLORER_ACCOUNT = "https://testnet.nearblocks.io/address/";
export const RPC_URLS = ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"];

/** Demo customers. Each has deposited sUSD, set limits, and authorised an agent key (scripts/02-demo.sh). */
export const PERSONAS = [
  { id: `alice.${CONTRACT}`, name: "Alice" },
  { id: `bob.${CONTRACT}`, name: "Bob" },
  { id: `carol.${CONTRACT}`, name: "Carol" },
] as const;

export const SHOP = `mama-mboga.${CONTRACT}`;
export const SUPPLIER = `supplier.${CONTRACT}`;

export const personaName = (id: string) =>
  PERSONAS.find((p) => p.id === id)?.name ?? id.split(".")[0];
