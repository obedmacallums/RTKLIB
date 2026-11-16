#!/usr/bin/env bash
# Build the RTKLIB console tools rnx2rtkp and convbin as WebAssembly ES modules.
# Requires an activated Emscripten SDK (emcc on PATH). Output goes to wasm/dist.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SRC="$ROOT/src"
OUT="${OUT:-$HERE/dist}"
mkdir -p "$OUT"

# Same feature set as the upstream gcc makefiles of the console apps.
DEFS="-DTRACE -DENAGLO -DENAQZS -DENAGAL -DENACMP -DENAIRN -DNFREQ=4 -DNEXOBS=3"
CFLAGS="-std=gnu99 -O3 -I$SRC $DEFS -Wno-unused-but-set-variable"

# MODULARIZE + EXPORT_ES6: each import gives a factory, so every run can use a
# fresh instance (RTKLIB keeps global state between calls to main).
# INVOKE_RUN=0: main is called explicitly through callMain(args).
LDFLAGS="-sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node \
  -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=67108864 -sMAXIMUM_MEMORY=4294967296 -sSTACK_SIZE=8388608 \
  -sFORCE_FILESYSTEM=1 -sEXPORTED_RUNTIME_METHODS=callMain,FS -lm"

COMMON="rtkcmn.c trace.c rinex.c sbas.c preceph.c pntpos.c ephemeris.c ionex.c \
  rtcm.c rtcm2.c rtcm3.c rtcm3e.c sofa.c"

RNX2RTKP="$COMMON rtkpos.c postpos.c solution.c lambda.c geoid.c options.c \
  ppp.c ppp_ar.c tides.c"

CONVBIN="$COMMON rcvraw.c convrnx.c rcv/novatel.c rcv/ublox.c rcv/crescent.c \
  rcv/skytraq.c rcv/javad.c rcv/nvs.c rcv/binex.c rcv/rt17.c rcv/septentrio.c \
  rcv/swiftnav.c rcv/unicore.c"

build() { # name main.c sources...
  local name="$1" main="$2"; shift 2
  local srcs=()
  for f in "$@"; do srcs+=("$SRC/$f"); done
  echo "== $name"
  # shellcheck disable=SC2086
  emcc $CFLAGS "$main" "${srcs[@]}" $LDFLAGS \
    -sEXPORT_NAME="create_${name}" -o "$OUT/$name.mjs"
}

# shellcheck disable=SC2086
build rnx2rtkp "$ROOT/app/consapp/rnx2rtkp/rnx2rtkp.c" $RNX2RTKP
# shellcheck disable=SC2086
build convbin "$ROOT/app/consapp/convbin/convbin.c" $CONVBIN

cp "$HERE/rtklib.mjs" "$OUT/rtklib.mjs"
ls -la "$OUT"
