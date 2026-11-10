import test from 'node:test';
import assert from 'node:assert/strict';
import { diffPlans } from '../../src/lib/plandiff.js';

const base=()=>({targets:{calories_kcal:1300,protein_g:100,carbs_g:120,fat_g:40},meals:[{name:'Breakfast',totals:{calories_kcal:400}},{name:'Lunch',totals:{calories_kcal:500}}],training_week:[{day:'Mon',focus:'Push'}]});

test('identical plans report no visible changes', () => {
  assert.equal(diffPlans(base(),base())[0].label,'No visible changes');
});
test('first plan', () => {
  assert.equal(diffPlans(null,base())[0].label,'New plan');
});
test('target, meal and training changes are reported', () => {
  const n=base();n.targets.calories_kcal=1500;n.meals[1].totals.calories_kcal=620;n.meals.push({name:'Snack',totals:{calories_kcal:150}});n.training_week.push({day:'Tue',focus:'Pull'});
  const d=Object.fromEntries(diffPlans(base(),n).map(x=>[x.label,x.detail]));
  assert.equal(d.Calories,'1300 → 1500 kcal');
  assert.equal(d['Meals added'],'Snack');
  assert.equal(d.Lunch,'500 → 620 kcal');
  assert.equal(d['Groceries added'],undefined);
  assert.equal(d['Training week'],'1 → 2 sessions');
});
