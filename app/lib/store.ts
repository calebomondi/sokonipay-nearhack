import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SHOP, SUPPLIER } from "./config";
import { toMicro } from "./units";

export type Item = {
  sku: string;
  name: string;
  price: number; // micro sUSD
  tags: string[]; // main | side | drink | meat | veg | ticket
  stock: number;
  reorderAt: number;
  restockQty: number;
  unitCost: number; // what the supplier charges per unit, micro sUSD
};

export type Rules = {
  /** Discount the Merchant Agent may give, by order subtotal. Code clamps anything above this. */
  tiers: { min: number; bps: number }[];
  groupBps: number;
  /** Table orders must carry a fresh presence code from the shop's screen. */
  presenceForTable: boolean;
  /** Procurement: never pay a supplier more than this multiple of the listed unit cost. */
  maxCostMarkup: number;
};

export type Merchant = {
  id: string;
  name: string;
  blurb: string;
  place: string;
  supplier?: string;
  rules: Rules;
  items: Item[];
};

export type Line = { sku: string; name: string; qty: number; unitPrice: number };

export type Ev =
  | { t: "status"; text: string; ok?: boolean }
  | { t: "msg"; from: "personal" | "merchant"; who: string; kind: string; text: string; lines?: Line[]; total?: number; discountBps?: number }
  | { t: "tx"; label: string; hash: string; who: string }
  | { t: "invoice"; id: string; total: number; kind: string; lines: Line[] }
  | { t: "refused"; text: string; reason: string; hash?: string }
  | { t: "receipt"; id: string; total: number; kind: string; payers: { id: string; amount: number }[] }
  | { t: "error"; text: string }
  | { t: "done" };

export type Session = {
  id: string;
  merchant: string;
  customer: string;
  members: string[];
  goal: string;
  mode: "table" | "pickup";
  status: "negotiating" | "invoiced" | "paid" | "refused" | "failed";
  invoiceId?: string;
  kind?: string;
  total?: number;
  lines?: Line[];
  events: Ev[];
  createdAt: number;
};

export type LogEntry = { at: number; merchant: string; kind: "sale" | "restock" | "refused" | "info"; text: string; hash?: string };

type Store = { merchants: Record<string, Merchant>; sessions: Session[]; log: LogEntry[] };

const item = (sku: string, name: string, usd: number, tags: string[], stock: number, reorderAt: number, restockQty: number, cost: number): Item => ({
  sku, name, price: toMicro(usd), tags, stock, reorderAt, restockQty, unitCost: toMicro(cost),
});

function seed(): Store {
  return {
    merchants: {
      [SHOP]: {
        id: SHOP,
        name: "Mama Mboga Kitchen",
        blurb: "Home-style Swahili plates, cooked to order",
        place: "Stall 14, Toi Market, Nairobi",
        supplier: SUPPLIER,
        rules: {
          tiers: [
            { min: toMicro(15), bps: 1000 },
            { min: toMicro(8), bps: 500 },
          ],
          groupBps: 1000,
          presenceForTable: true,
          maxCostMarkup: 1.1,
        },
        items: [
          item("pilau", "Beef pilau", 3.5, ["main", "meat"], 14, 6, 12, 0.7),
          item("choma", "Nyama choma", 6.0, ["main", "meat"], 8, 3, 6, 1.5),
          item("githeri", "Githeri bowl", 2.8, ["main", "veg"], 12, 5, 12, 0.5),
          item("sukuma", "Sukuma wiki", 1.2, ["side", "veg"], 7, 6, 20, 0.3),
          item("ugali", "Ugali", 0.8, ["side", "veg"], 20, 6, 20, 0.2),
          item("chapati", "Chapati", 0.5, ["side", "veg"], 24, 8, 24, 0.15),
          item("samosa", "Samosa pair", 1.0, ["side", "meat"], 16, 6, 16, 0.3),
          item("chai", "Masala chai", 0.6, ["drink", "veg"], 30, 8, 30, 0.1),
          item("juice", "Fresh mango juice", 1.5, ["drink", "veg"], 12, 5, 12, 0.5),
          item("band-night", "Friday band night entry", 5.0, ["ticket"], 40, 0, 0, 0),
        ],
      },
      [SUPPLIER]: {
        id: SUPPLIER,
        name: "Wholesale Greens",
        blurb: "Produce and dry goods for market kitchens",
        place: "Wakulima Market, Nairobi",
        rules: { tiers: [], groupBps: 0, presenceForTable: false, maxCostMarkup: 1 },
        items: [],
      },
    },
    sessions: [],
    log: [],
  };
}

// State is kept in memory and mirrored to a small JSON file so a restart keeps orders, stock and the log.
// Money never lives here: balances, invoices and receipts are read from the contract.
// Kept outside the project folder: the dev server reloads on file changes there, which drops live streams.
const FILE = path.join(process.env.DATA_DIR || path.join(os.tmpdir(), "sokonipay"), "store.json");

function load(): Store {
  const fresh = seed();
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, "utf8")) as Store;
    for (const [id, m] of Object.entries(fresh.merchants)) {
      for (const i of m.items) {
        const old = saved.merchants?.[id]?.items.find((x) => x.sku === i.sku);
        if (old) i.stock = old.stock; // keep stock levels, take everything else from code
      }
    }
    fresh.sessions = saved.sessions ?? [];
    fresh.log = saved.log ?? [];
  } catch {
    /* first run */
  }
  return fresh;
}

let saving: NodeJS.Timeout | undefined;
export function persist() {
  clearTimeout(saving);
  saving = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(store));
    } catch {
      /* read-only disk: carry on in memory */
    }
  }, 300);
}

const g = globalThis as unknown as { __sokoni?: Store };
export const store: Store = (g.__sokoni ??= load());

export const getMerchant = (id: string) => store.merchants[id];
export const addLog = (e: Omit<LogEntry, "at">) => {
  store.log.unshift({ at: Date.now(), ...e });
  store.log.length = Math.min(store.log.length, 100);
  persist();
};
