// Tests the post-workout review validation (workout.ts) under Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanReviewInput, normalizeWeek, sameWeek, cleanReviewOutput } from '../../supabase/functions/the-cut-ai/workout.ts';

const week = () => [
  { day: 'Mon', focus: 'Push', session_minutes: 60, exercises: ['Bench Press 3x8', 'Overhead Press 3x8'] },
  { day: 'Tue', focus: 'Rest', session_minutes: 0, exercises: [] },
  { day: 'Wed', focus: 'Pull', session_minutes: 50, exercises: ['Row 3x10'] },
];

test('cleanReviewInput keeps valid data and drops junk', () => {
  const { input, error } = cleanReviewInput({
    session: { id: 'abc', title: 'Push', date: '2026-11-10', duration_min: 62, effort: 8, plan_day: 'Mon',
      exercises: [{ name: 'Bench Press', planned: 'Bench Press 3x8', sets: [{ kg: '60', reps: 8 }, { kg: 60, reps: 7 }] }, { name: '', sets: [{ kg: 1, reps: 1 }] }, { name: 'Empty', sets: [] }] },
    feedback: [{ exercise: 'Bench Press', rating: 'too_hard', issues: ['joint_pain', 'made_up'], note: 'left shoulder pinch' }, { exercise: 'Row', rating: 'nope', issues: [], note: '' }],
  });
  assert.equal(error, '');
  assert.equal(input.session.exercises.length, 1);
  assert.deepEqual(input.session.exercises[0].sets, [{ kg: 60, reps: 8 }, { kg: 60, reps: 7 }]);
  assert.equal(input.feedback.length, 1);
  assert.deepEqual(input.feedback[0].issues, ['joint_pain']);
  assert.equal(input.session.effort, 8);
});

test('cleanReviewInput rejects a session with no completed sets', () => {
  assert.equal(cleanReviewInput({ session: { exercises: [] } }).input, null);
  assert.equal(cleanReviewInput({}).input, null);
});

test('normalizeWeek accepts a sensible progression', () => {
  const next = week();
  next[0].exercises = ['Bench Press 3x8 @ 62.5 kg', 'Overhead Press 3x8'];
  next[0].session_minutes = 55;
  const r = normalizeWeek(week(), next);
  assert.deepEqual(r.problems, []);
  assert.equal(r.week[0].exercises[0], 'Bench Press 3x8 @ 62.5 kg');
  assert.equal(sameWeek(week(), r.week), false);
  assert.equal(sameWeek(week(), week()), true);
});

test('normalizeWeek never rewrites rest days and clamps session length to +/-30%', () => {
  const next = week();
  next[1] = { day: 'Tue', focus: 'Heavy squats', session_minutes: 90, exercises: ['Squat 5x5'] };
  next[2].session_minutes = 200;
  const r = normalizeWeek(week(), next);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.week[1], week()[1]);
  assert.equal(r.week[2].session_minutes, 65);
});

test('normalizeWeek rejects reordered days, wrong length, empty days and >8 sets', () => {
  const swapped = week(); swapped[0].day = 'Thu';
  assert.equal(normalizeWeek(week(), swapped).week, null);
  assert.equal(normalizeWeek(week(), week().slice(0, 2)).week, null);
  const empty = week(); empty[0].exercises = [];
  assert.equal(normalizeWeek(week(), empty).week, null);
  const big = week(); big[0].exercises = ['Squat 12 sets x 5'];
  assert.match(normalizeWeek(week(), big).problems.join(' '), /more than 8 sets/);
  assert.equal(normalizeWeek(week(), 'nope').week, null);
  assert.equal(normalizeWeek([], week()).week, null);
});

test('cleanReviewOutput trims and caps', () => {
  const o = cleanReviewOutput({ headline: 'x'.repeat(200), analysis: 'ok', issues: ['a', '', 'b', 'c', 'd', 'e'], change_notes: ['n'] });
  assert.equal(o.headline.length, 80);
  assert.equal(o.issues.length, 4);
  assert.deepEqual(o.change_notes, ['n']);
});
