// Run every probe with bounded concurrency; record each verdict as JSONL.
import { readdir, writeFile, appendFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const OUT = '/tmp/claude-0/-home-user-MonoFX/6e76713a-e052-5f67-a07d-369d6ef8c673/scratchpad/suite.jsonl';
await writeFile(OUT, '');
const all = (await readdir('.')).filter(f => f.endsWith('.mjs') && !f.startsWith('_') && f !== 'ex-lib.mjs').sort();
console.log('probes:', all.length);
const LIMIT = 3, TIMEOUT = 15 * 60 * 1000;
let i = 0, done = 0;
const runOne = (name) => new Promise(res => {
  const t0 = Date.now();
  const p = spawn('node', [name], { cwd: '.' });
  let out = '';
  const kill = setTimeout(() => { try{ p.kill('SIGKILL'); }catch(e){} }, TIMEOUT);
  p.stdout.on('data', d => { out += d; if(out.length > 400000) out = out.slice(-200000); });
  p.stderr.on('data', d => { out += d; if(out.length > 400000) out = out.slice(-200000); });
  p.on('close', async code => {
    clearTimeout(kill);
    // a verdict line may carry trailing prose ('VERDICT: PASS — no external
    // requests'), so anchor on the word, not the end of the line
    const m = out.match(/^(.*)VERDICT:\s*(PASS|FAIL)\b/mi);
    const fails = (out.match(/^\s*FAIL\b.*$/gmi) || []).slice(0, 6).map(s => s.trim().slice(0, 200));
    const rec = { name, code, ms: Date.now() - t0,
      verdict: m ? m[2].toUpperCase() : (/VERDICT/i.test(out) ? 'UNKNOWN' : 'NONE'),
      label: m ? m[1].trim().slice(0, 60) : null, fails,
      crashed: code !== 0 && !m };
    await appendFile(OUT, JSON.stringify(rec) + '\n');
    done++;
    console.log(`[${done}/${all.length}] ${name.padEnd(30)} ${rec.verdict}${rec.crashed ? ' (crash)' : ''}`);
    res();
  });
});
const workers = Array.from({ length: LIMIT }, async () => { while(i < all.length) await runOne(all[i++]); });
await Promise.all(workers);
console.log('SUITE COMPLETE');
