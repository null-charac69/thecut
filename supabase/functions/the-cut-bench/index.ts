// TEMPORARY model benchmark, run next to Bedrock in Mumbai with the app's own Bedrock keys. Not used by the app.
// Called from the database with pg_net (see docs/RUNBOOK.md). Deploy with ../the-cut-ai/{bench,plan,lists,prompts}.ts
// copied next to it. After a benchmark, redeploy it as a stub that returns 410.
// deno-lint-ignore-file no-explicit-any
import { AwsClient } from "npm:aws4fetch@1";
import { looseJson, runCoach, TASKS } from "./bench.ts";
import { chatJson } from "./llm.ts";

const KEY_SHA256 = "d022579d17936684916af8c2a2aab32d70c679d395f554fac6110e2d676d1401";
const sha = async (t: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map((x) => x.toString(16).padStart(2, "0")).join("");
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if ((await sha(req.headers.get("x-bench-key") ?? "")) !== KEY_SHA256) return json({ error: "forbidden" }, 403);
  const body = await req.json().catch(() => ({}));
  const region = String(body.region || "ap-south-1");
  const aws = new AwsClient({
    accessKeyId: Deno.env.get("LLM_AWS_ACCESS_KEY_ID") ?? "",
    secretAccessKey: Deno.env.get("LLM_AWS_SECRET_ACCESS_KEY") ?? "",
    region,
    service: "bedrock",
  });
  const where = { fn_region: Deno.env.get("SB_REGION") ?? null, bedrock_region: region, secret_region: Deno.env.get("LLM_AWS_REGION") ?? null, secret_model: Deno.env.get("LLM_MODEL") ?? null, secret_fast: Deno.env.get("LLM_MODEL_FAST") ?? null };
  if (body.mode === "list") {
    const out: Record<string, unknown> = { where };
    for (const p of ["foundation-models?byOutputModality=TEXT", "inference-profiles?maxResults=200"]) {
      const r = await aws.fetch(`https://bedrock.${region}.amazonaws.com/${p}`);
      out[p.split("?")[0]] = r.ok ? await r.json() : { status: r.status, error: (await r.text()).slice(0, 200) };
    }
    return json(out);
  }
  if (body.mode === "adapter") {
    // Runs the PRODUCTION adapter (llm.ts) with the production secrets: proves region, models and Converse end to end.
    const out: unknown[] = [];
    for (const fast of [true, false]) {
      const t0 = Date.now();
      try {
        const r = await chatJson({ system: TASKS.coach.system, user: `<user_data>\n${TASKS.coach.user}\n</user_data>\nReply with the next JSON.`, fast, maxTokens: 1500, temperature: 0.3 });
        out.push({ fast, ms: Date.now() - t0, model: r.model, provider: r.provider, grade: TASKS.coach.grade(r.json) });
      } catch (e) {
        out.push({ fast, ms: Date.now() - t0, error: String(e).slice(0, 200) });
      }
    }
    return json({ where, out });
  }
  const T = TASKS[String(body.task)];
  if (!T) return json({ error: "unknown task" }, 400);
  const model = String(body.model);
  let noTemp = false, outTokens = 0;
  // One Converse call, as production makes it (including the resend without temperature for models that reject it).
  const converse = async (user: string): Promise<{ ms: number; text?: string; error?: string }> => {
    for (let i = 0; i < 2; i++) {
      const t0 = Date.now();
      const res = await aws.fetch(`https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(model)}/converse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system: [{ text: T.system }], messages: [{ role: "user", content: [{ text: user }] }], inferenceConfig: { maxTokens: Math.min(8192, T.maxTokens + 2000), ...(noTemp ? {} : { temperature: 0.3 }) } }),
        signal: AbortSignal.timeout(140_000),
      }).catch((e) => e);
      const ms = Date.now() - t0;
      if (res instanceof Error) return { ms, error: "fetch failed: " + String(res).slice(0, 120) };
      if (!res.ok) {
        const t = (await res.text()).slice(0, 160);
        if (res.status === 400 && /temperature/i.test(t) && !noTemp) { noTemp = true; continue; }
        return { ms, error: `${res.status} ${t}` };
      }
      const d = await res.json();
      outTokens += d?.usage?.outputTokens ?? 0;
      return { ms, text: (d?.output?.message?.content ?? []).filter((b: any) => typeof b?.text === "string").map((b: any) => b.text).join("") };
    }
    return { ms: 0, error: "no response" };
  };
  const base = { model, task: body.task, run: body.run ?? 0, where: { fn_region: where.fn_region, bedrock_region: region } };
  if (body.task === "coach" || body.task === "coach2") {
    const r = await runCoach(converse, T.user);
    if (r.error) return json({ ...base, ms: r.ms, calls: r.calls, ok: false, score: 0, notes: [r.error] });
    const g = r.json ? T.grade(r.json) : { ok: false, score: 0, notes: ["not valid JSON"] };
    return json({ ...base, ms: r.ms, calls: r.calls, out_tokens: outTokens, ...g, head: String(r.json?.final ?? "").slice(0, 900) });
  }
  const r = await converse(T.user);
  if (r.error) return json({ ...base, ms: r.ms, calls: 1, ok: false, score: 0, notes: [r.error] });
  const j = looseJson(r.text ?? "");
  const g = j ? T.grade(j) : { ok: false, score: 0, notes: ["not valid JSON"] };
  return json({ ...base, ms: r.ms, calls: 1, out_tokens: outTokens, ...g, head: (r.text ?? "").slice(0, 160) });
});
