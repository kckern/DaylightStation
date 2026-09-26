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
// Textures are bitmaps, so they are not in the repo: they live on the media
// mount and a console manifest names them (`presentation.ejs_shader_textures`).
// EmulatorSession fetches them at boot (loadShaderTextures) and attaches them
// to the preset (withShaderTextures).
//
// Pure: no asset imports here, so it unit-tests without Vite. The composed
// table that the arcade hands to the engine lives in emulatorShaders.js.

/**
 * Assemble one preset entry, with no textures yet.
 * @param {object} args
 * @param {string} args.preset - the .glslp text
 * @param {Array<[string,string]>} args.passes - [fileName, glslSource] per pass
 * @returns {{shader:{type:'text',value:string},resources:Array<{name:string,type:'text',value:string}>,binaries:Record<string,Uint8Array>}}
 */
export function buildShaderEntry({ preset, passes }) {
  if (typeof preset !== 'string' || !preset.trim()) throw new Error('buildShaderEntry: preset text is required');
  if (!Array.isArray(passes) || passes.length === 0) throw new Error('buildShaderEntry: at least one pass is required');
  return {
    shader: { type: 'text', value: preset },
    resources: passes.map(([name, value]) => ({ name, type: 'text', value })),
    binaries: {},
  };
}

/**
 * Fetch a preset's textures as raw bytes.
 *
 * `textures` maps the file name the preset references (e.g. `paper-bg.png`) to
 * a path under `base` (the engine route). A texture that cannot be fetched is
 * reported in `missing`, never thrown.
 *
 * @param {Record<string,string>} textures
 * @param {object} [opts]
 * @param {string} [opts.base] - URL prefix the paths resolve against
 * @param {Function} [opts.fetchImpl]
 * @returns {Promise<{bytes:Record<string,Uint8Array>, missing:Array<{name:string,url:string,error:string}>}>}
 */
export async function loadShaderTextures(textures, { base = '', fetchImpl = globalThis.fetch } = {}) {
  const bytes = {};
  const missing = [];
  await Promise.all(Object.entries(textures || {}).map(async ([name, path]) => {
    const url = `${base}${String(path).replace(/^\/+/, '')}`;
    try {
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bytes[name] = new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      missing.push({ name, url, error: err?.message || String(err) });
    }
  }));
  return { bytes, missing };
}

/** A copy of `table` with `bytes` attached to preset `name`; the table itself is never mutated. */
export function withShaderTextures(table, name, bytes) {
  if (!table?.[name]) return table;
  return { ...table, [name]: { ...table[name], binaries: { ...table[name].binaries, ...bytes } } };
}

/**
 * A copy of `table` without preset `name` — for a preset whose textures did not
 * arrive. EmulatorJS then turns shading off for that name: an unfiltered
 * picture, rather than a shader sampling textures that are not there.
 */
export function withoutShader(table, name) {
  if (!table?.[name]) return table;
  const { [name]: _dropped, ...rest } = table;
  return rest;
}
