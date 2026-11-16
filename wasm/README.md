# RTKLIB for WebAssembly

Builds two RTKLIB console tools as WebAssembly ES modules, without changing
any RTKLIB source file:

| Module | Tool | Use |
|---|---|---|
| `rnx2rtkp.mjs` / `.wasm` | `rnx2rtkp` | Post-processing: PPK, static, single, PPP |
| `convbin.mjs` / `.wasm` | `convbin` | Raw logs (UBX, RTCM 2/3, NovAtel, Septentrio, ...) to RINEX |

They run in browsers, web workers and Node. Files are passed through an
in-memory file system, so nothing is uploaded anywhere.

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

Notes:

- Each call creates a fresh module instance, because RTKLIB keeps global
  state between runs. Do not reuse an instance for a second `callMain`.
- The call blocks the thread it runs on. In a browser, call it from a web
  worker so the page stays responsive.
- Memory starts at 64 MB and grows on demand up to 4 GB. Inputs and outputs
  live in memory, so very large logs need that much RAM.
- Compile-time options match the upstream gcc makefiles
  (`-DENAGLO -DENAQZS -DENAGAL -DENACMP -DENAIRN -DNFREQ=4 -DNEXOBS=3 -DTRACE`).
  Change `DEFS` in `build.sh` to alter them.
- `rtkrcv`, `str2str` and the other real-time tools are not built: they need
  sockets, serial ports and threads.

## Keeping up with upstream

`main` tracks [rtklibexplorer/RTKLIB](https://github.com/rtklibexplorer/RTKLIB)
(the demo5 branch of RTKLIB). The WebAssembly files live only in `wasm/` and
`.github/workflows/wasm.yml` on the `wasm` branch, so merging `main` into
`wasm` should not conflict.
