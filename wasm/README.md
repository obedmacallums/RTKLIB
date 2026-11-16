# RTKLIB for WebAssembly

Builds the five RTKLIB console apps as WebAssembly ES modules, without
changing any RTKLIB source file:

| Module | Kind | Use |
|---|---|---|
| `rnx2rtkp` | batch | Post-processing: PPK, static, single, PPP |
| `convbin` | batch | Raw logs (UBX, RTCM 2/3, NovAtel, Septentrio, ...) to RINEX |
| `pos2kml` | batch | Solution file (.pos) to KML, GPX or CSV |
| `str2str` | server | Stream relay and format conversion (file, TCP, NTRIP) |
| `rtkrcv` | server | Real-time positioning (RTK/PPP) from input streams |

They run in browsers, web workers and Node. Files are passed through an
in-memory file system, so nothing is uploaded anywhere. The Qt and Windows
GUI apps (rtkpost, rtkplot, rtknavi, ...) are not built.

## Build

Needs the [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html)
(tested with 3.1.74) and Node 18 or later for the test.

```bash
source /path/to/emsdk/emsdk_env.sh
bash wasm/build.sh          # output in wasm/dist
node wasm/test/smoke.mjs    # runs both tools on the data in test/data
```

Every push to the `wasm` branch runs the same steps in GitHub Actions and
uploads `wasm/dist` as the `rtklib-wasm` artifact.

## Use

`rtklib.mjs` wraps both modules. Arguments are the same as on the command line.

```js
import { rnx2rtkp, convbin } from './dist/rtklib.mjs';

const r = await rnx2rtkp({
  args: ['-k', 'ppk.conf', '-o', 'out.pos', 'rover.obs', 'base.obs', 'nav.nav'],
  files: {
    'ppk.conf': confText,          // string or bytes
    'rover.obs': roverBytes,       // Uint8Array / ArrayBuffer
    'base.obs': baseBytes,
    'nav.nav': navBytes,
  },
  onLog: (stream, line) => console.log(stream, line),
});

r.exitCode;             // 0 on success
r.files['out.pos'];     // Uint8Array; also out_events.pos when the log has events
r.stdout; r.stderr;
```

The servers return a handle instead of a result, because they run until stopped:

```js
import { str2str } from './dist/rtklib.mjs';

const s = await str2str({
  args: ['-in', 'file://log.ubx', '-out', 'file://copy.ubx'],
  files: { 'log.ubx': bytes },
});
s.readFiles();              // outputs so far
const r = await s.stop();   // sends SIGINT; same result shape as above
```

Notes:

- Each call creates a fresh module instance, because RTKLIB keeps global
  state between runs.
- Batch tools block the thread they run on. In a browser, call them from a
  web worker so the page stays responsive.
- `str2str` and `rtkrcv` use threads (`SharedArrayBuffer`). In a browser the
  page must be cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin`
  and `Cross-Origin-Embedder-Policy: require-corp`). Start `rtkrcv` with `-nc`
  (no console).
- Networking in the servers is limited by the platform: there are no serial
  ports, and in a browser TCP/NTRIP streams only work as outgoing WebSocket
  connections through a proxy such as websockify. In Node, sockets need the
  `ws` package. Only file streams are covered by the test.
- Memory starts at 64 MB and grows on demand up to 4 GB. Inputs and outputs
  live in memory, so very large logs need that much RAM.
- Compile-time options match the upstream gcc makefiles
  (`-DENAGLO -DENAQZS -DENAGAL -DENACMP -DENAIRN -DNFREQ=4 -DNEXOBS=3 -DTRACE`).
  Change `DEFS` in `build.sh` to alter them.

## Keeping up with upstream

`main` is kept identical to
[rtklibexplorer/RTKLIB](https://github.com/rtklibexplorer/RTKLIB) (the demo5
branch of RTKLIB). The WebAssembly files live only in `wasm/` and
`.github/workflows/` on the `wasm` branch, so merging never conflicts unless
upstream adds files with the same names.

- Automatic: the `sync-upstream` workflow runs every Monday (or on demand from
  the Actions tab). It fast-forwards `main`, merges it into `wasm`, rebuilds
  and runs the test.
- Manual: `bash wasm/sync-upstream.sh` does the same from a local clone; the
  push to `wasm` triggers the build.

If upstream adds or removes source files, update the lists in `build.sh`.
