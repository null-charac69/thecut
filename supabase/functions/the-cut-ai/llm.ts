// Provider-agnostic LLM adapter for THE CUT.
// Speaks the OpenAI-compatible Chat Completions API, so Groq, Cerebras, OpenRouter,
// Gemini (OpenAI endpoint), Mistral or a self-hosted vLLM all work by changing secrets only.
//
// AWS Bedrock without an API key (SigV4): set LLM_BASE_URL=https://bedrock-runtime.<region>.amazonaws.com/openai/v1,
//   LLM_AWS_ACCESS_KEY_ID, LLM_AWS_SECRET_ACCESS_KEY, LLM_AWS_REGION (LLM_API_KEY is then unused).
// Secrets (Supabase -> Edge Functions -> Secrets):
//   LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, LLM_MODEL_FAST (optional)
//   LLM_FALLBACK_BASE_URL, LLM_FALLBACK_API_KEY, LLM_FALLBACK_MODEL, LLM_FALLBACK_MODEL_FAST (optional)

import { AwsClient } from "npm:aws4fetch@1";

export class LlmError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

type Cfg = { baseUrl: string; apiKey: string; model: string; label: string; aws?: AwsClient };

function configs(fast: boolean): Cfg[] {
  const out: Cfg[] = [];
  const add = (prefix: string, label: string) => {
    const baseUrl = Deno.env.get(`${prefix}BASE_URL`);
    const apiKey = Deno.env.get(`${prefix}API_KEY`);
    const model = (fast ? Deno.env.get(`${prefix}MODEL_FAST`) : undefined) ?? Deno.env.get(`${prefix}MODEL`);
    const akid = Deno.env.get(`${prefix}AWS_ACCESS_KEY_ID`)?.trim();
    const sak = Deno.env.get(`${prefix}AWS_SECRET_ACCESS_KEY`)?.trim();
    const region = Deno.env.get(`${prefix}AWS_REGION`)?.trim();
    if (baseUrl && model && akid && sak && region) {
      out.push({
        baseUrl: baseUrl.trim().replace(/\/+$/, ""),
        apiKey: "",
        model: model.trim(),
        label,
        aws: new AwsClient({ accessKeyId: akid, secretAccessKey: sak, region, service: "bedrock" }),
      });
    } else if (baseUrl && apiKey && model) {
      out.push({ baseUrl: baseUrl.trim().replace(/\/+$/, ""), apiKey: apiKey.trim(), model: model.trim(), label });
    }
  };
  add("LLM_", "primary");
  add("LLM_FALLBACK_", "fallback");
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function parseLooseJson(text: string): unknown {
  const trimmed = text.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch { /* fall through */ }
  const fenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  try {
    return JSON.parse(fenced);
  } catch { /* fall through */ }
  // Models sometimes emit several objects back to back (e.g. a tool call followed by an invented answer).
  // Take the FIRST balanced, string-aware JSON object.
  const a = trimmed.indexOf("{");
  if (a >= 0) {
    let depth = 0, inStr = false, esc = false;
    for (let i = a; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try {
          return JSON.parse(trimmed.slice(a, i + 1));
        } catch { break; }
      }
    }
    const b = trimmed.lastIndexOf("}");
    if (b > a) return JSON.parse(trimmed.slice(a, b + 1));
  }
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
        const payload = JSON.stringify({
          model: c.model,
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
          temperature: opts.temperature ?? 0.3,
          // Reasoning models count hidden thinking against max_tokens, so give Bedrock extra headroom.
          max_tokens: Math.max(opts.maxTokens ?? 4000, c.aws ? 8000 : 0),
          // Bedrock's OpenAI layer may not accept response_format; the prompt + parseLooseJson cover it.
          ...(c.aws ? { reasoning_effort: "low" } : { response_format: { type: "json_object" } }),
          // OpenRouter reasoning models can burn the whole token budget on hidden thinking; keep it minimal.
          ...(c.baseUrl.includes("openrouter.ai") ? { reasoning: { effort: "low", exclude: true } } : {}),
        });
        const url = `${c.baseUrl}/chat/completions`;
        const signal = AbortSignal.timeout(100_000);
        const res = c.aws
          ? await c.aws.fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, signal })
          : await fetch(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json" },
            body: payload,
            signal,
          });

        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number(res.headers.get("retry-after") ?? "0") * 1000;
          let why = "";
          try { why = String(JSON.parse((await res.text()).slice(0, 600))?.error?.message ?? "").replace(/gsk_[A-Za-z0-9]+/g, "[key]").slice(0, 200); } catch { /* not JSON */ }
          last = new LlmError(`The AI service is busy (${res.status}${why ? ": " + why : ""}). Try again in a minute.`, 503);
          console.error(`LLM ${c.label} ${res.status} ${why}`);
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
        try {
          return { json: parseLooseJson(text), model: c.model, provider: c.label };
        } catch (pe) {
          console.error(`LLM ${c.label} bad JSON finish=${data?.choices?.[0]?.finish_reason} len=${text.length} head=${text.slice(0, 120)} tail=${text.slice(-120)}`);
          last = pe instanceof LlmError ? pe : new LlmError("The AI returned a response that was not valid JSON.", 502);
          if (attempt === 0) continue; // one retry: small models occasionally emit malformed JSON
          break;
        }
      } catch (e) {
        console.error(`LLM ${c.label} failed`, String(e));
        last = e instanceof LlmError ? e : new LlmError("Could not reach the AI service.", 502);
        break;
      }
    }
  }
  throw last ?? new LlmError("The AI request failed.", 502);
}
