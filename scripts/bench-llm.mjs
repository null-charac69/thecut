// Benchmarks Bedrock models on THE CUT's real jobs (production prompts and validators) through the Converse API,
// the same API the edge function uses. Default region ap-south-1 (Mumbai).
// Run: AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... MODELS=id1,id2 node --experimental-strip-types scripts/bench-llm.mjs
// Optional: AWS_REGION, RUNS (default 3), DRY=1 (no network, canned answers; tests the harness).
// The same benchmark also runs server-side from supabase/functions/the-cut-bench (see docs/RUNBOOK.md).
import { AwsClient } from 'aws4fetch';
import { CANNED, TASKS, choose, looseJson, median } from '../supabase/functions/the-cut-ai/bench.ts';

const REGION = process.env.AWS_REGION || 'ap-south-1';
const RUNS = Number(process.env.RUNS || 3);
const DRY = process.env.DRY === '1';
const MODELS = (process.env.MODELS || '').split(',').map((m) => m.trim()).filter(Boolean);
const aws = DRY ? null : new AwsClient({ accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, region: REGION, service: 'bedrock' });

async function call(model, task) {
  const t0 = Date.now();
  if (DRY) return { ms: 5, json: CANNED[task] };
  const T = TASKS[task];
  const res = await aws.fetch(`https://bedrock-runtime.${REGION}.amazonaws.com/model/${encodeURIComponent(model)}/converse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system: [{ text: T.system }], messages: [{ role: 'user', content: [{ text: T.user }] }], inferenceConfig: { maxTokens: Math.min(8192, T.maxTokens + 2000), temperature: 0.3 } }),
    signal: AbortSignal.timeout(120_000),
  });
  const ms = Date.now() - t0;
  if (!res.ok) return { ms, error: `${res.status} ${(await res.text()).slice(0, 140)}` };
  const d = await res.json();
  const text = (d?.output?.message?.content ?? []).filter((c) => typeof c.text === 'string').map((c) => c.text).join('');
  return { ms, json: looseJson(text) };
}

async function main() {
  if (!MODELS.length) { console.error('Set MODELS=<bedrock model id>,<...>'); process.exit(2); }
  const results = {};
  for (const model of MODELS) {
    results[model] = {};
    for (const task of Object.keys(TASKS)) {
      const runs = [];
      for (let i = 0; i < RUNS; i++) {
        const r = await call(model, task);
        const g = r.error ? { ok: false, score: 0, notes: [r.error] } : r.json ? TASKS[task].grade(r.json) : { ok: false, score: 0, notes: ['not valid JSON'] };
        runs.push({ ms: r.ms, ...g });
      }
      const t = (results[model][task] = {
        p50: median(runs.map((x) => x.ms)), max: Math.max(...runs.map((x) => x.ms)),
        okRate: runs.filter((x) => x.ok).length / runs.length, score: Math.round(runs.reduce((a, x) => a + x.score, 0) / runs.length),
        notes: [...new Set(runs.flatMap((x) => x.notes))].slice(0, 3),
      });
      console.log(`${model.padEnd(42)} ${task.padEnd(6)} p50 ${(t.p50 / 1000).toFixed(1)}s max ${(t.max / 1000).toFixed(1)}s ok ${Math.round(t.okRate * 100)}% score ${t.score} ${t.notes.join('; ')}`);
    }
  }
  const pick = choose(results);
  console.log(`\nRecommended: LLM_MODEL=${pick.heavy}  LLM_MODEL_FAST=${pick.light}  (region ${REGION})`);
}

main();
