// Provider-agnostic LLM adapter for THE CUT.
// Speaks the OpenAI-compatible Chat Completions API, so Groq, Cerebras, OpenRouter,
// Gemini (OpenAI endpoint), Mistral or a self-hosted vLLM all work by changing secrets only.
//
// Secrets (Supabase -> Edge Functions -> Secrets):
//   LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, LLM_MODEL_FAST (optional)
//   LLM_FALLBACK_BASE_URL, LLM_FALLBACK_API_KEY, LLM_FALLBACK_MODEL, LLM_FALLBACK_MODEL_FAST (optional)

export class LlmError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

type Cfg = { baseUrl: string; apiKey: string; model: string; label: string };

function configs(fast: boolean): Cfg[] {
  const out: Cfg[] = [];
  const add = (prefix: string, label: string) => {
    const baseUrl = Deno.env.get(`${prefix}BASE_URL`);
    const apiKey = Deno.env.get(`${prefix}API_KEY`);
    const model = (fast ? Deno.env.get(`${prefix}MODEL_FAST`) : undefined) ?? Deno.env.get(`${prefix}MODEL`);
    if (baseUrl && apiKey && model) {
      out.push({ baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, model, label });
    }
  };
  add("LLM_", "primary");
  add("LLM_FALLBACK_", "fallback");
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function parseLooseJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch { /* fall through */ }
  const fenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  try {
    return JSON.parse(fenced);
  } catch { /* fall through */ }
  const a = trimmed.indexOf("{");
  const b = trimmed.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(trimmed.slice(a, b + 1));
  throw new LlmError("The AI returned a response that was not valid JSON.", 502);
}

export interface ChatJsonOptions {
  system: string;
  user: string;
  fast?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export interface ChatJsonResult {
  json: unknown;
  model: string;
  provider: string;
}

// Calls the primary provider, retrying once on a short rate-limit wait, then the fallback provider.
export async function chatJson(opts: ChatJsonOptions): Promise<ChatJsonResult> {
  const providers = configs(!!opts.fast);
  if (!providers.length) throw new LlmError("The AI backend is not configured.", 503);

  let last: LlmError | null = null;
  for (const c of providers) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${c.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: c.model,
            messages: [
              { role: "system", content: opts.system },
              { role: "user", content: opts.user },
            ],
            temperature: opts.temperature ?? 0.3,
            max_tokens: opts.maxTokens ?? 4000,
            response_format: { type: "json_object" },
          }),
          signal: AbortSignal.timeout(100_000),
        });

        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number(res.headers.get("retry-after") ?? "0") * 1000;
          last = new LlmError("The AI service is busy. Try again in a minute.", 503);
          console.error(`LLM ${c.label} ${res.status}`);
          if (attempt === 0 && res.status === 429 && retryAfter > 0 && retryAfter <= 15_000) {
            await sleep(retryAfter);
            continue;
          }
          break;
        }
        if (!res.ok) {
          const body = (await res.text()).slice(0, 300);
          console.error(`LLM ${c.label} ${res.status}: ${body}`);
          // Provider error text is sanitised (no keys, bounded) so a misconfiguration is diagnosable.
          let detail = "";
          try { detail = String(JSON.parse(body)?.error?.message ?? "").replace(/gsk_[A-Za-z0-9]+|sk-[A-Za-z0-9_-]+/g, "[key]").slice(0, 160); } catch { /* not JSON */ }
          last = new LlmError(`The AI service rejected the request (${res.status}${detail ? ": " + detail : ""}).`, 502);
          break;
        }
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (typeof text !== "string" || !text.trim()) {
          last = new LlmError("The AI returned an empty response.", 502);
          break;
        }
        return { json: parseLooseJson(text), model: c.model, provider: c.label };
      } catch (e) {
        console.error(`LLM ${c.label} failed`, String(e));
        last = e instanceof LlmError ? e : new LlmError("Could not reach the AI service.", 502);
        break;
      }
    }
  }
  throw last ?? new LlmError("The AI request failed.", 502);
}
