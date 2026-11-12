import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Account, FailoverRpcProvider, JsonRpcProvider, actions, type KeyPairString } from "near-api-js";
import { CONTRACT, RPC_URLS } from "./config";

const provider = new FailoverRpcProvider(RPC_URLS.map((url) => new JsonRpcProvider({ url })));

/**
 * Agent keys are NEAR function-call access keys: they can only call the listed SokoniPay
 * methods and can never attach a deposit, so they cannot withdraw or change limits.
 * Hosted: AGENT_KEYS_JSON = {"account.testnet":"ed25519:..."}. Local: files written by scripts/02-demo.sh.
 */
function agentKey(accountId: string): KeyPairString {
  if (process.env.AGENT_KEYS_JSON) {
    const key = JSON.parse(process.env.AGENT_KEYS_JSON)[accountId];
    if (key) return key;
  }
  const dir = process.env.AGENT_KEYS_DIR || path.join(os.homedir(), ".near-credentials", "sokonipay-agents");
  const file = path.join(dir, `${accountId}.json`);
  if (!fs.existsSync(file)) throw new Error(`No agent key for ${accountId}. Run scripts/02-demo.sh first.`);
  return JSON.parse(fs.readFileSync(file, "utf8")).private_key;
}

export function hasAgentKey(accountId: string) {
  try {
    agentKey(accountId);
    return true;
  } catch {
    return false;
  }
}

export async function view<T>(method: string, args: object = {}, contractId = CONTRACT): Promise<T> {
  return (await provider.callFunction({ contractId, method, args: args as Record<string, unknown> })) as T;
}

export class ContractError extends Error {
  constructor(message: string, public txHash?: string) {
    super(message);
  }
}

// One transaction at a time per account, so nonces never collide.
const queues = new Map<string, Promise<unknown>>();

/** Call a SokoniPay method signed by the account's agent key. Returns the tx hash and decoded result. */
export function agentCall<T = unknown>(accountId: string, method: string, args: object): Promise<{ hash: string; result: T }> {
  const run = async () => {
    const account = new Account(accountId, provider, agentKey(accountId));
    let res;
    try {
      res = await account.signAndSendTransaction({
        receiverId: CONTRACT,
        actions: [actions.functionCall(method, args, BigInt(100_000_000_000_000), BigInt(0))],
        throwOnFailure: false,
      });
    } catch (e) {
      throw new ContractError(panicMessage(String((e as Error)?.message ?? e)));
    }
    const hash = res.transaction?.hash as string;
    const status = res.status as { SuccessValue?: string; Failure?: unknown };
    if (status && typeof status === "object" && "Failure" in status) {
      throw new ContractError(panicMessage(JSON.stringify(status.Failure)), hash);
    }
    const raw = status?.SuccessValue ? Buffer.from(status.SuccessValue, "base64").toString() : "";
    return { hash, result: (raw ? JSON.parse(raw) : undefined) as T };
  };
  const prev = queues.get(accountId) ?? Promise.resolve();
  const next = prev.then(run, run);
  queues.set(accountId, next.catch(() => undefined));
  return next;
}

function panicMessage(s: string) {
  const m = s.match(/Smart contract panicked: ([^"\\]+)/);
  return m ? m[1].trim() : s.slice(0, 300);
}
