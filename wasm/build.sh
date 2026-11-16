#!/usr/bin/env bash
# Build the RTKLIB console apps (rnx2rtkp, convbin, pos2kml, str2str, rtkrcv)
# as WebAssembly ES modules.
# Requires an activated Emscripten SDK (emcc on PATH). Output goes to wasm/dist.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SRC="$ROOT/src"
APP="$ROOT/app/consapp"
OUT="${OUT:-$HERE/dist}"
mkdir -p "$OUT"

# Same feature set as the upstream gcc makefiles of the console apps.
DEFS="-DTRACE -DENAGLO -DENAQZS -DENAGAL -DENACMP -DENAIRN -DNFREQ=4 -DNEXOBS=3"
CFLAGS="-std=gnu99 -O3 -I$SRC $DEFS -Wno-unused-but-set-variable"

# MODULARIZE + EXPORT_ES6: each import gives a factory, so every run can use a
# fresh instance (RTKLIB keeps global state between calls to main).
# INVOKE_RUN=0: main is called explicitly through callMain(args).
LDFLAGS="-sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node \
  -sINVOKE_RUN=0 -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=67108864 -sMAXIMUM_MEMORY=4294967296 -sSTACK_SIZE=8388608 \
  -sFORCE_FILESYSTEM=1 -sEXPORTED_RUNTIME_METHODS=callMain,FS -lm"

# Batch tools: main() runs to completion on the calling thread.
BATCH="-sEXIT_RUNTIME=0"

# str2str and rtkrcv are servers: they use threads and run until interrupted.
# PROXY_TO_PTHREAD runs main() in a worker so callMain() returns at once;
# _raise is exported so JavaScript can deliver SIGINT to stop them.
SERVER="-pthread -DSVR_REUSEADDR -sPROXY_TO_PTHREAD=1 -sEXIT_RUNTIME=1 \
  -sDEFAULT_PTHREAD_STACK_SIZE=8388608 -sEXPORTED_FUNCTIONS=_main,_raise \
  -Wno-pthreads-mem-growth"

BASE="rtkcmn.c trace.c sofa.c preceph.c solution.c geoid.c"
RTCM="rtcm.c rtcm2.c rtcm3.c rtcm3e.c sbas.c"
RCV="rcvraw.c rcv/novatel.c rcv/ublox.c rcv/crescent.c rcv/skytraq.c \
  rcv/javad.c rcv/nvs.c rcv/binex.c rcv/rt17.c rcv/septentrio.c \
  rcv/swiftnav.c rcv/unicore.c"
POS="rtkpos.c pntpos.c ephemeris.c ionex.c rinex.c lambda.c options.c \
  ppp.c ppp_ar.c tides.c"

build() { # name "extra flags" main.c [more absolute .c ...] -- src-relative sources...
  local name="$1" extra="$2"; shift 2
  local srcs=()
  while [ "$1" != "--" ]; do srcs+=("$1"); shift; done
  shift
  for f in "$@"; do srcs+=("$SRC/$f"); done
  echo "== $name"
  # shellcheck disable=SC2086
  emcc $CFLAGS $extra "${srcs[@]}" $LDFLAGS \
    -sEXPORT_NAME="create_${name}" -o "$OUT/$name.mjs"
}

# shellcheck disable=SC2086
{
build rnx2rtkp "$BATCH" "$APP/rnx2rtkp/rnx2rtkp.c" -- $BASE $RTCM $POS postpos.c
build convbin  "$BATCH" "$APP/convbin/convbin.c"   -- $BASE $RTCM $RCV \
  pntpos.c ephemeris.c ionex.c rinex.c convrnx.c
build pos2kml  "$BATCH" "$APP/pos2kml/pos2kml.c"   -- $BASE convkml.c convgpx.c
build str2str  "$SERVER" "$APP/str2str/str2str.c"  -- $BASE $RTCM $RCV \
  stream.c streamsvr.c
build rtkrcv   "$SERVER -I$APP/rtkrcv" "$APP/rtkrcv/rtkrcv.c" "$APP/rtkrcv/vt.c" -- \
  $BASE $RTCM $RCV $POS rtksvr.c stream.c
}

cp "$HERE/rtklib.mjs" "$OUT/rtklib.mjs"
ls -la "$OUT"
