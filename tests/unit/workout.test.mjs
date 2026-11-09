import test from 'node:test';
import assert from 'node:assert/strict';
import { e1rm, volOf, parsePlanExercise, parseWorkoutExerciseLine, planTargetKg, diffWeek } from '../../src/lib/workout.js';

test('e1rm uses the Epley formula and is 0 for empty input', () => {
  assert.ok(Math.abs(e1rm(100, 5) - 100 * (1 + 5 / 30)) < 1e-9);
  assert.equal(e1rm(0, 5), 0);
  assert.equal(e1rm(100, 0), 0);
});

test('volOf sums only completed sets', () => {
  const ex = [
    { sets: [{ kg: 100, reps: 5, done: true }, { kg: 100, reps: 5, done: false }] },
    { sets: [{ kg: '60', reps: '10', done: true }, { kg: '', reps: 8, done: true }] },
  ];
  assert.equal(volOf(ex), 100 * 5 + 60 * 10);
  assert.equal(volOf([]), 0);
});

test('parsePlanExercise reads name, sets and reps', () => {
  assert.deepEqual(parsePlanExercise('Bench Press 3x8'), { name: 'Bench Press', sets: 3, reps: 8 });
  assert.deepEqual(parsePlanExercise('Squat: 4 sets x 6 reps'), { name: 'Squat', sets: 4, reps: 6 });
});

test('parsePlanExercise falls back to 3x10 and caps sets at 8', () => {
  assert.deepEqual(parsePlanExercise('Pull-ups'), { name: 'Pull-ups', sets: 3, reps: 10 });
  assert.equal(parsePlanExercise('Row 12 sets x 5').sets, 8);
  assert.equal(parsePlanExercise('').name, '');
});

test('parsePlanExercise truncates long names to 60 characters', () => {
  assert.equal(parsePlanExercise('A'.repeat(100)).name.length, 60);
});

test('parseWorkoutExerciseLine parses per-set reps@kg', () => {
  const r = parseWorkoutExerciseLine('Bench | 8@60, 6@62.5');
  assert.equal(r.name, 'Bench');
  assert.deepEqual(r.sets, [
    { set_number: 1, reps: 8, weight_kg: 60 },
    { set_number: 2, reps: 6, weight_kg: 62.5 },
  ]);
});

test('parseWorkoutExerciseLine parses count | reps | kg and rejects empty names', () => {
  const r = parseWorkoutExerciseLine('Squat | 3 | 5 | 100');
  assert.equal(r.sets.length, 3);
  assert.deepEqual(r.sets[0], { set_number: 1, reps: 5, weight_kg: 100 });
  assert.equal(parseWorkoutExerciseLine(' | 3@5'), null);
});

test('planTargetKg reads an AI load target and ignores everything else', () => {
  assert.equal(planTargetKg('Bench Press 3x8 @ 62.5 kg'), 62.5);
  assert.equal(planTargetKg('Squat 4x6 (try 100kg)'), 100);
  assert.equal(planTargetKg('Pull-ups 3x8'), null);
  assert.equal(planTargetKg('Row 3x10 @ 0 kg'), null);
  assert.equal(planTargetKg(''), null);
});

test('diffWeek lists minutes, load, added and removed exercises per day', () => {
  const prev = [
    { day: 'Mon', focus: 'Push', session_minutes: 60, exercises: ['Bench Press 3x8', 'Overhead Press 3x8', 'Dips 3x10'] },
    { day: 'Tue', focus: 'Rest', session_minutes: 0, exercises: [] },
  ];
  const next = [
    { day: 'Mon', focus: 'Push', session_minutes: 55, exercises: ['Bench Press 3x8 @ 62.5 kg', 'Landmine Press 3x10', 'Dips 3x10'] },
    { day: 'Tue', focus: 'Rest', session_minutes: 0, exercises: [] },
  ];
  const d = diffWeek(prev, next);
  assert.equal(d.length, 1);
  assert.equal(d[0].label, 'Mon · Push');
  assert.match(d[0].detail, /60 → 55 min/);
  assert.match(d[0].detail, /Bench Press 3x8 → Bench Press 3x8 @ 62.5 kg/);
  assert.match(d[0].detail, /added Landmine Press 3x10/);
  assert.match(d[0].detail, /removed Overhead Press 3x8/);
  assert.deepEqual(diffWeek(prev, prev), []);
  assert.deepEqual(diffWeek(null, next), []);
});
