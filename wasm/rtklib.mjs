// Thin helper around the rnx2rtkp / convbin WebAssembly modules.
// Works in browsers, web workers and Node. Every call uses a fresh module
// instance because RTKLIB keeps global state between runs.
//
//   import { rnx2rtkp, convbin } from './rtklib.mjs';
//   const r = await rnx2rtkp({
//     args: ['-p', '2', '-o', 'out.pos', 'rover.obs', 'base.obs', 'nav.nav'],
//     files: { 'rover.obs': bytes, 'base.obs': bytes, 'nav.nav': bytes },
//   });
//   r.files['out.pos']  // Uint8Array

const WORK = '/work';

async function run(factoryUrl, { args = [], files = {}, onLog } = {}) {
  const { default: create } = await import(factoryUrl);
  const stdout = [];
  const stderr = [];
  const mod = await create({
    print: (s) => { stdout.push(s); onLog?.('stdout', s); },
    printErr: (s) => { stderr.push(s); onLog?.('stderr', s); },
  });
  const { FS } = mod;
  FS.mkdir(WORK);
  FS.chdir(WORK);
  const inputs = new Set();
  for (const [name, data] of Object.entries(files)) {
    FS.writeFile(name, typeof data === 'string' ? data : new Uint8Array(data));
    inputs.add(name);
  }

  let exitCode = 0;
  try {
    exitCode = mod.callMain(args.map(String)) ?? 0;
  } catch (e) {
    // exit() inside main surfaces as an ExitStatus exception.
    if (e && typeof e.status === 'number') exitCode = e.status;
    else throw e;
  }

  const out = {};
  const walk = (dir, prefix) => {
    for (const name of FS.readdir(dir)) {
      if (name === '.' || name === '..') continue;
      const path = `${dir}/${name}`;
      const rel = prefix ? `${prefix}/${name}` : name;
      if (FS.isDir(FS.stat(path).mode)) walk(path, rel);
      else if (!inputs.has(rel)) out[rel] = FS.readFile(path);
    }
  };
  walk(WORK, '');

  return { exitCode, stdout: stdout.join('\n'), stderr: stderr.join('\n'), files: out };
}

/** Post-processing (PPK/PPP/single). Same arguments as the rnx2rtkp CLI. */
export const rnx2rtkp = (opts) => run(new URL('./rnx2rtkp.mjs', import.meta.url).href, opts);

/** Raw receiver log (UBX, RTCM, ...) to RINEX. Same arguments as the convbin CLI. */
export const convbin = (opts) => run(new URL('./convbin.mjs', import.meta.url).href, opts);
