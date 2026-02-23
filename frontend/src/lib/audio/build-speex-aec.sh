#!/bin/bash
# Build Speex AEC as a self-contained WASM module for AudioWorklet use.
# Requires: Emscripten (emcc) — install via ~/emsdk
# Output: speex_aec.js (WASM embedded as base64, MODULARIZE=1)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENDOR_DIR="$SCRIPT_DIR/vendor/speexdsp"
OUT_DIR="$SCRIPT_DIR"

# Generate config_types.h (normally done by autotools)
cat > "$VENDOR_DIR/include/speex/speexdsp_config_types.h" <<'HEADER'
#ifndef __SPEEX_TYPES_H__
#define __SPEEX_TYPES_H__

#include <stdint.h>

typedef int16_t spx_int16_t;
typedef uint16_t spx_uint16_t;
typedef int32_t spx_int32_t;
typedef uint32_t spx_uint32_t;

#endif
HEADER

# Source files needed for echo cancellation
SOURCES=(
  "$VENDOR_DIR/libspeexdsp/mdf.c"
  "$VENDOR_DIR/libspeexdsp/preprocess.c"
  "$VENDOR_DIR/libspeexdsp/kiss_fft.c"
  "$VENDOR_DIR/libspeexdsp/kiss_fftr.c"
  "$VENDOR_DIR/libspeexdsp/fftwrap.c"
  "$VENDOR_DIR/libspeexdsp/filterbank.c"
  "$VENDOR_DIR/libspeexdsp/buffer.c"
)

INCLUDES="-I$VENDOR_DIR/include -I$VENDOR_DIR/libspeexdsp -I$VENDOR_DIR"

echo "Building Speex AEC WASM..."
echo "  Sources: ${#SOURCES[@]} files"
echo "  Output: $OUT_DIR/speex_aec.js"

# Source emsdk if emcc not on PATH
if ! command -v emcc &>/dev/null; then
  if [ -f "$HOME/emsdk/emsdk_env.sh" ]; then
    source "$HOME/emsdk/emsdk_env.sh" 2>/dev/null
  else
    echo "ERROR: emcc not found. Install Emscripten: https://emscripten.org" >&2
    exit 1
  fi
fi

emcc -O2 \
  -s WASM=1 \
  -s SINGLE_FILE=1 \
  -s EXPORTED_FUNCTIONS="['_speex_echo_state_init','_speex_echo_cancellation','_speex_echo_state_destroy','_speex_echo_ctl','_malloc','_free']" \
  -s EXPORTED_RUNTIME_METHODS="['ccall','cwrap','getValue','setValue','HEAPF32','HEAP16']" \
  -s INITIAL_MEMORY=1048576 \
  -s ALLOW_MEMORY_GROWTH=0 \
  -s ENVIRONMENT='worker' \
  -s MODULARIZE=1 \
  -s EXPORT_NAME='SpeexModule' \
  -DFLOATING_POINT \
  -DUSE_KISS_FFT \
  -DEXPORT="" \
  -DHAVE_CONFIG_H \
  $INCLUDES \
  "${SOURCES[@]}" \
  -o "$OUT_DIR/speex_aec.js"

SIZE=$(wc -c < "$OUT_DIR/speex_aec.js" | tr -d ' ')
echo "Built: $OUT_DIR/speex_aec.js ($SIZE bytes)"
