import { parse } from '@babel/parser';
import { readFileSync, writeFileSync } from 'node:fs';
const [file, fnName, ...pats] = process.argv.slice(2);
let src = readFileSync(file, 'utf8');
const ast = parse(src, { sourceType: 'module' });
const fn = ast.program.body.find((n) => n.type === 'FunctionDeclaration' && n.id.name === fnName);
const ranges = [];
for (const st of fn.body.body) { const t = src.slice(st.start, st.end); const hit = pats.find((p) => t.includes(p)); if (hit) { ranges.push([st.start, st.end]); console.log('rm', hit, '::', t.slice(0, 90).replace(/\n/g, ' ')); } }
ranges.sort((a, b) => b[0] - a[0]);
for (const [s, e] of ranges) src = src.slice(0, s) + src.slice(e);
writeFileSync(file, src);
