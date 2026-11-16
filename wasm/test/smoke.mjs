// Smoke test for the WebAssembly build, using the sample data shipped in test/data.
// Run with: node wasm/test/smoke.mjs   (after wasm/build.sh)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rnx2rtkp, convbin } from '../dist/rtklib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const data = (p) => readFileSync(join(root, 'test', 'data', p));
const text = (u8) => new TextDecoder().decode(u8);
const fail = (msg, r) => {
  console.error(`FAIL: ${msg}`);
  if (r) console.error(r.stdout, '\n', r.stderr);
  process.exit(1);
};

// 1. Kinematic baseline: rover + base + navigation -> .pos
{
  const r = await rnx2rtkp({
    args: ['-p', '2', '-o', 'out.pos', 'rover.05o', 'base.05o', 'nav.05n'],
    files: {
      'rover.05o': data('rinex/07590920.05o'),
      'base.05o': data('rinex/30400920.05o'),
      'nav.05n': data('rinex/30400920.05n'),
    },
  });
  const pos = r.files['out.pos'];
  if (!pos) fail('rnx2rtkp produced no out.pos', r);
  const lines = text(pos).split('\n');
  const epochs = lines.filter((l) => l && !l.startsWith('%'));
  if (epochs.length < 10) fail(`rnx2rtkp produced only ${epochs.length} epochs`, r);
  const q = {};
  for (const l of epochs) { const k = l.trim().split(/\s+/)[5]; q[k] = (q[k] ?? 0) + 1; }
  console.log(`rnx2rtkp: ${epochs.length} epochs, by quality flag ${JSON.stringify(q)}`);
  console.log(lines.filter((l) => l.startsWith('% pos mode') || l.startsWith('% program')).join('\n'));
}

// 2. u-blox raw log -> RINEX
{
  const r = await convbin({
    args: ['-r', 'ubx', '-o', 'out.obs', '-n', 'out.nav', 'log.ubx'],
    files: { 'log.ubx': data('rcvraw/ubx_20080526.ubx') },
  });
  const obs = r.files['out.obs'];
  if (!obs) fail('convbin produced no out.obs', r);
  const head = text(obs).split('\n')[0];
  if (!head.includes('RINEX VERSION')) fail(`unexpected RINEX header: ${head}`, r);
  console.log(`convbin: ${Object.keys(r.files).join(', ')} (${obs.length} bytes of observations)`);
}

console.log('OK');
