import { esc } from './format.js';

// Maps raw auth/network errors to a title/body shown in dialogs.
/** @param {any} err @returns {{kind:string,title:string,body:string}} */
export function friendlyError(err){
 const raw=String(err?.message||err||'');const code=String(err?.code||err?.error_code||'');
 if(/invalid login credentials|invalid_credentials/i.test(raw+code))return{kind:'creds',title:'Wrong email or password',body:'That email and password don’t match an account. Check for typos, or reset your password.'};
 if(/rate limit|too many|over_request|over_email_send|429/i.test(raw+code))return{kind:'rate',title:'Too many attempts',body:'Slow down a bit. Wait a minute or two, then try again.'};
 if(/already registered|already been registered|user_already_exists/i.test(raw+code))return{kind:'exists',title:'Account already exists',body:'There is already an account with that email. Sign in instead, or reset your password.'};
 if(/weak_password|password should|pwned|easy to guess|at least \d+ char/i.test(raw+code))return{kind:'weak',title:'Choose a stronger password',body:esc(raw.replace(/^AuthWeakPasswordError:?\s*/,''))||'Use at least 8 characters and avoid common passwords.'};
 if(/failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(raw)||!navigator.onLine)return{kind:'net',title:'No connection',body:'We can’t reach the server. Check your internet connection and try again.'};
 if(/jwt|refresh token|not authenticated|session.*(expired|missing)|invalid claim/i.test(raw+code))return{kind:'session',title:'Session expired',body:'For your security you were signed out. Sign in again to continue.'};
 if(/signup.*disabled|signups not allowed/i.test(raw+code))return{kind:'other',title:'Sign-ups are closed',body:'New accounts are disabled right now.'};
 return{kind:'other',title:'Something went wrong',body:esc(raw)||'Please try again.'};
}
