import test from 'node:test';
import assert from 'node:assert/strict';
import { e1rm, volOf, parsePlanExercise, parseWorkoutExerciseLine } from '../../src/lib/workout.js';

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
