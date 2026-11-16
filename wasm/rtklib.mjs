// Thin helper around the RTKLIB WebAssembly modules.
// Works in browsers, web workers and Node. Every call uses a fresh module
// instance because RTKLIB keeps global state between runs.
//
//   import { rnx2rtkp, convbin, pos2kml, str2str, rtkrcv } from './rtklib.mjs';
//
//   // Batch tools run to completion:
//   const r = await rnx2rtkp({
//     args: ['-p', '2', '-o', 'out.pos', 'rover.obs', 'base.obs', 'nav.nav'],
//     files: { 'rover.obs': bytes, 'base.obs': bytes, 'nav.nav': bytes },
//   });
//   r.files['out.pos']  // Uint8Array
//
//   // Servers keep running until stopped:
//   const s = await str2str({ args: ['-in', 'file://in.ubx', '-out', 'file://out.ubx'], files });
//   ...
//   const r2 = await s.stop();

const WORK = '/work';

async function load(name, { files = {}, onLog, onExit } = {}) {
  const { default: create } = await import(new URL(`./${name}.mjs`, import.meta.url).href);
  const stdout = [];
  const stderr = [];
  const mod = await create({
    print: (s) => { stdout.push(s); onLog?.('stdout', s); },
    printErr: (s) => { stderr.push(s); onLog?.('stderr', s); },
    stdin: () => null, // no interactive input
    onExit,
  });
  const { FS } = mod;
  FS.mkdir(WORK);
  FS.chdir(WORK);
  const inputs = new Set();
  for (const [fname, data] of Object.entries(files)) {
    const dir = fname.split('/').slice(0, -1).join('/');
    if (dir) FS.mkdirTree(`${WORK}/${dir}`);
    FS.writeFile(`${WORK}/${fname}`, typeof data === 'string' ? data : new Uint8Array(data));
    inputs.add(fname);
  }

  // Files in the work directory. Inputs are skipped unless all is true.
  const readFiles = (all = false) => {
    const out = {};
    const walk = (dir, prefix) => {
      for (const entry of FS.readdir(dir)) {
        if (entry === '.' || entry === '..') continue;
        const path = `${dir}/${entry}`;
        const rel = prefix ? `${prefix}/${entry}` : entry;
        if (FS.isDir(FS.stat(path).mode)) walk(path, rel);
        else if (all || !inputs.has(rel)) out[rel] = FS.readFile(path);
      }
    };
    walk(WORK, '');
    return out;
  };
  const result = (exitCode) => ({
    exitCode, stdout: stdout.join('\n'), stderr: stderr.join('\n'), files: readFiles(),
  });
  return { mod, readFiles, result };
}

// Batch tool: run main() to completion and return its outputs.
async function run(name, opts = {}) {
  const { mod, result } = await load(name, opts);
  let exitCode = 0;
  try {
    exitCode = mod.callMain((opts.args ?? []).map(String)) ?? 0;
  } catch (e) {
    // exit() inside main surfaces as an ExitStatus exception.
    if (e && typeof e.status === 'number') exitCode = e.status;
    else throw e;
  }
  return result(exitCode);
}

// Server tool: main() runs in a worker thread until stop() is called or it
// exits by itself. Needs SharedArrayBuffer (cross-origin isolated page, or Node).
async function start(name, opts = {}) {
  let finish;
  const exited = new Promise((resolve) => { finish = resolve; });
  let handle;
  const onExit = (code) => finish(handle.result(code));
  handle = await load(name, { ...opts, onExit });
  try {
    handle.mod.callMain((opts.args ?? []).map(String));
  } catch (e) {
    if (!(e && typeof e.status === 'number')) throw e;
  }
  return {
    /** Resolves with { exitCode, stdout, stderr, files } when the tool exits. */
    exited,
    /** Current files in the work directory, readable while the tool runs. */
    readFiles: handle.readFiles,
    /** Emscripten file system, to append input or read output on the fly. */
    FS: handle.mod.FS,
    /** Send SIGINT, as Ctrl-C would, and wait for the tool to exit. */
    stop: () => { handle.mod._raise(2); return exited; },
  };
}

/** Post-processing (PPK/PPP/single). Same arguments as the rnx2rtkp CLI. */
export const rnx2rtkp = (opts) => run('rnx2rtkp', opts);

/** Raw receiver log (UBX, RTCM, ...) to RINEX. Same arguments as the convbin CLI. */
export const convbin = (opts) => run('convbin', opts);

/** Solution file (.pos) to KML, GPX or CSV. Same arguments as the pos2kml CLI. */
export const pos2kml = (opts) => run('pos2kml', opts);

/** Stream server. Same arguments as the str2str CLI. Returns a running handle. */
export const str2str = (opts) => start('str2str', opts);

/** Real-time positioning server. Same arguments as the rtkrcv CLI; pass -nc. */
export const rtkrcv = (opts) => start('rtkrcv', opts);
