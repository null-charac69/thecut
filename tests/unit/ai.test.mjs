import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_REGION, aiUrl } from '../../src/lib/ai.js';

test('AI function is pinned to Mumbai by default', () => {
  assert.equal(AI_REGION, 'ap-south-1');
  assert.equal(
    aiUrl('https://x.supabase.co'),
    'https://x.supabase.co/functions/v1/the-cut-ai?forceFunctionRegion=ap-south-1'
  );
});

test('trailing slashes and an empty region are handled', () => {
  assert.equal(aiUrl('https://x.supabase.co/', ''), 'https://x.supabase.co/functions/v1/the-cut-ai');
  assert.equal(aiUrl('https://x.supabase.co//', 'eu-west-1').endsWith('?forceFunctionRegion=eu-west-1'), true);
});
