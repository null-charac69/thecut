import { S } from './state.js';
import { renderAuthV2 } from './auth.js';
import { supabase } from './client.js';
import { bootstrap } from './shell.js';
import './plan.js';
import './meals.js';
import './coach.js';
import './prep.js';
import './account.js';
import './weight.js';
import './workout.js';
import './feedback.js';
import './ui.js';

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

const {
  data: { session: initial },
} = await supabase.auth.getSession();

S.session = initial;

if (S.session && !S.recoveryMode) await bootstrap();
else if (!S.recoveryMode) renderAuthV2();
