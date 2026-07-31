// loadStretchEngine.js — load signalsmith-stretch WITHOUT letting the bundler
// touch it. The library builds its AudioWorklet script by stringifying its own
// functions (Function.toString of post-build source); Vite/esbuild class-field
// lowering and minifier renames plant references (__publicField helper, renamed
// closure vars) that don't exist inside the AudioWorkletGlobalScope blob, so the
// processor constructor throws silently and the init handshake never arrives —
// dead air after createMediaElementSource. `?url` emits the pristine npm file as
// a verbatim asset; `@vite-ignore` keeps Rollup from bundling the dynamic import
// so the browser evaluates that exact file. The package is self-contained (WASM
// inlined as base64), so nothing else needs to travel with it.
import stretchUrl from 'signalsmith-stretch/SignalsmithStretch.mjs?url';

export default async function loadStretchEngine() {
  const { default: SignalsmithStretch } = await import(/* @vite-ignore */ stretchUrl);
  return SignalsmithStretch;
}
