import "server-only";

/** NEAR AI Cloud: OpenAI-compatible, inference runs inside a TEE. Without a key the agents run scripted. */
const BASE = process.env.NEARAI_BASE_URL || "https://cloud-api.near.ai/v1";
const MODEL = process.env.NEARAI_MODEL || "deepseek-ai/DeepSeek-V3.1";

export const llmEnabled = () => !!process.env.NEARAI_API_KEY && process.env.AGENT_MODE !== "scripted";
export const agentMode = () => (llmEnabled() ? `NEAR AI Cloud (${MODEL})` : "scripted rules");

/** Ask for a JSON object. Returns null on any failure so callers fall back to scripted logic. */
export async function llmJson<T>(system: string, user: string): Promise<T | null> {
  if (!llmEnabled()) return null;
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.NEARAI_API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        max_tokens: 500,
        messages: [
          { role: "system", content: `${system}\nReply with one JSON object only, no prose, no code fences.` },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const text: string = (await res.json()).choices?.[0]?.message?.content ?? "";
    const m = text.match(/\{[\s\S]*\}/);
    return m ? (JSON.parse(m[0]) as T) : null;
  } catch {
    return null;
  }
}
