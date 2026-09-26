// customShaders.js — build our own EmulatorJS picture-shader presets.
//
// EmulatorJS registers extra presets through `window.EJS_shaders`, each as
// `{ shader: {type,value}, resources: [{name,type,value}] }`, and `enableShader`
// writes them into the core's /shader directory. That path is text-only in
// practice: a base64 resource is atob()'d to a string and FS.writeFile UTF-8
// encodes strings, so a PNG texture arrives corrupted. Texture bytes therefore
// ride in a third field, `binaries`, that the engine writes itself as raw
// Uint8Arrays (see EmulatorEngine.applyShader) and the loader strips before
// EmulatorJS sees the table (see loadEmulatorJS.buildEjsGlobals).
//
// Pure: no asset imports here, so it unit-tests without Vite. The composed
// table that the arcade hands to the engine lives in emulatorShaders.js.

/**
 * Decode a `data:` URI (as Vite's `?inline` import yields) to raw bytes.
 * @param {string} uri
 * @returns {Uint8Array}
 */
export function dataUriToBytes(uri) {
  if (typeof uri !== 'string' || !uri.startsWith('data:')) {
    throw new Error(`dataUriToBytes: expected a data: URI, got ${String(uri).slice(0, 32)}`);
  }
  const comma = uri.indexOf(',');
  const meta = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  if (!/;base64$/i.test(meta)) {
    throw new Error('dataUriToBytes: only base64 data URIs are supported');
  }
  const bin = atob(payload);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Assemble one preset entry.
 * @param {object} args
 * @param {string} args.preset - the .glslp text
 * @param {Array<[string,string]>} args.passes - [fileName, glslSource] per pass
 * @param {Array<[string,string]>} [args.textures] - [fileName, dataUri] per LUT
 * @returns {{shader:{type:'text',value:string},resources:Array<{name:string,type:'text',value:string}>,binaries:Record<string,Uint8Array>}}
 */
export function buildShaderEntry({ preset, passes, textures = [] }) {
  if (typeof preset !== 'string' || !preset.trim()) throw new Error('buildShaderEntry: preset text is required');
  if (!Array.isArray(passes) || passes.length === 0) throw new Error('buildShaderEntry: at least one pass is required');
  return {
    shader: { type: 'text', value: preset },
    resources: passes.map(([name, value]) => ({ name, type: 'text', value })),
    binaries: Object.fromEntries(textures.map(([name, uri]) => [name, dataUriToBytes(uri)])),
  };
}
