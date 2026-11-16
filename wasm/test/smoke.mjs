// Smoke test for the WebAssembly build, using the sample data shipped in test/data.
// Run with: node wasm/test/smoke.mjs   (after wasm/build.sh)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rnx2rtkp, convbin, pos2kml, str2str, rtkrcv } from '../dist/rtklib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const data = (p) => readFileSync(join(root, 'test', 'data', p));
const text = (u8) => new TextDecoder().decode(u8);
const fail = (msg, r) => {
  console.error(`FAIL: ${msg}`);
  if (r) console.error(r.stdout, '\n', r.stderr);
  process.exit(1);
};

// 1. Kinematic baseline: rover + base + navigation -> .pos
let posFile;
{
  const r = await rnx2rtkp({
    args: ['-p', '2', '-o', 'out.pos', 'rover.05o', 'base.05o', 'nav.05n'],
    files: {
      'rover.05o': data('rinex/07590920.05o'),
      'base.05o': data('rinex/30400920.05o'),
      'nav.05n': data('rinex/30400920.05n'),
    },
  });
  const pos = posFile = r.files['out.pos'];
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

// 3. Solution -> KML
{
  const r = await pos2kml({ args: ['-o', 'out.kml', 'out.pos'], files: { 'out.pos': posFile } });
  const kml = r.files['out.kml'];
  if (!kml || !text(kml).includes('<kml')) fail('pos2kml produced no KML', r);
  console.log(`pos2kml: out.kml (${kml.length} bytes)`);
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
// Wait until a server has written `name` and its size stops changing.
const settle = async (srv, name, maxMs = 30000) => {
  let last = -1;
  for (let t = 0; t < maxMs; t += 1000) {
    await sleep(1000);
    const size = srv.readFiles()[name]?.length ?? 0;
    if (size > 0 && size === last) return size;
    last = size;
  }
  return last;
};

// 4. Stream server: replay a file into another file, then stop it
{
  const ubx = data('rcvraw/ubx_20080526.ubx');
  const s = await str2str({
    args: ['-in', 'file://log.ubx', '-out', 'file://copy.ubx'],
    files: { 'log.ubx': ubx },
  });
  const size = await settle(s, 'copy.ubx');
  const r = await s.stop();
  if (size !== ubx.length) fail(`str2str copied ${size} of ${ubx.length} bytes`, r);
  console.log(`str2str: copied ${size} bytes, exit code ${r.exitCode}`);
}

// 5. Real-time server: single point positioning from a replayed u-blox log
{
  const conf = [
    'pos1-posmode=single',
    'inpstr1-type=file', 'inpstr1-path=log.ubx', 'inpstr1-format=ubx',
    'outstr1-type=file', 'outstr1-path=rt.pos', 'outstr1-format=llh',
  ].join('\n') + '\n';
  const s = await rtkrcv({
    args: ['-nc', '-o', 'rt.conf'],
    files: { 'rt.conf': conf, 'log.ubx': data('rcvraw/ubx_20080526.ubx') },
  });
  await settle(s, 'rt.pos');
  const r = await s.stop();
  const pos = r.files['rt.pos'];
  if (!pos) fail('rtkrcv produced no rt.pos', r);
  const epochs = text(pos).split('\n').filter((l) => l && !l.startsWith('%'));
  if (epochs.length < 10) fail(`rtkrcv produced only ${epochs.length} epochs`, r);
  console.log(`rtkrcv: ${epochs.length} epochs, exit code ${r.exitCode}`);
}

console.log('OK');
process.exit(0);
