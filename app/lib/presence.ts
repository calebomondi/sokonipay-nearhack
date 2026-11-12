import "server-only";
import crypto from "node:crypto";

/**
 * Rotating presence code shown as a QR on the merchant's screen.
 * token = window.hmac(secret, merchant|window). A window is 10 s; the current and
 * previous windows are accepted. It proves the customer saw the merchant's screen
 * just now, without collecting any location.
 */
const WINDOW_MS = 10_000;
const secret = () => process.env.PRESENCE_QR_SECRET || "dev-only-presence-secret";
const sign = (merchant: string, w: number) =>
  crypto.createHmac("sha256", secret()).update(`${merchant}|${w}`).digest("hex").slice(0, 16);

export function presenceToken(merchant: string, now = Date.now()) {
  const w = Math.floor(now / WINDOW_MS);
  return { token: `${w.toString(36)}.${sign(merchant, w)}`, expiresInMs: WINDOW_MS - (now % WINDOW_MS) };
}

export function verifyPresence(merchant: string, token: string | undefined, now = Date.now()) {
  if (!token) return false;
  const [w36, mac] = token.split(".");
  const w = parseInt(w36, 36);
  const cur = Math.floor(now / WINDOW_MS);
  if (!Number.isFinite(w) || w > cur || cur - w > 2) return false;
  const expected = sign(merchant, w);
  return mac?.length === expected.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}
