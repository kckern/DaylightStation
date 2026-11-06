/**
 * Pin safe-window mutes to the spoken word with a person's help.
 *
 *   contentfilter pin-page <rk> --src <file>
 *     Cuts one clip per safe-window mute (the window plus 1 s each side) and
 *     writes refine/<rk>/pin/index.html: play, press "Mark word" as the word
 *     starts (or "Not spoken here"), then Copy results.
 *
 *   contentfilter pin <rk> --src <file> --marks <file> [--write]
 *     Reads the copied lines ("<id>: <film seconds>" or "<id>: none"), snaps
 *     each mark to the word's onset (energy edges, as refine does) and its end,
 *     and writes those mutes as ms-precise into the refined EDL.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import yaml from 'js-yaml';
import { FfmpegRefineMedia } from '../../server/adapters/content-filter/FfmpegRefineMedia.mjs';
import { boundaryCandidates } from '../../server/domain/content-filter/refine/audioCandidates.mjs';
import { wordMatcher, wordPrompt } from '../../server/domain/content-filter/refine/cueKinds.mjs';
import { PythonWordAligner } from '../../server/adapters/content-filter/PythonWordAligner.mjs';
import { refinedEdlName } from '../../server/domain/content-filter/refine/refinedEdl.mjs';
import { certify } from '../../server/domain/content-filter/refine/certification.mjs';
import { mapSpan, unmapTime } from '../../../../../shared/contracts/content-filter/syncMap.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ms = (t) => Math.round(t * 1000) / 1000;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function load({ rk, mediaFilterDir, dataFilterDir }) {
  const edl = yaml.load(readFileSync(path.join(mediaFilterDir, 'edl', `${rk}.edl.yml`), 'utf8'));
  const refinedPath = path.join(mediaFilterDir, 'refined', refinedEdlName(edl));
  if (!existsSync(refinedPath)) throw new Error(`No refined EDL (${refinedPath})`);
  const refined = yaml.load(readFileSync(refinedPath, 'utf8'));
  const override = yaml.load(readFileSync(path.join(dataFilterDir, 'overrides', `${rk}.yml`), 'utf8')) || {};
  if (!override.sync) throw new Error(`Override for ${rk} has no sync`);
  const seen = new Set();
  const targets = refined.cues.filter((c) => c.type === 'mute' && c.precision === 'safe-window' && !seen.has(c.id) && seen.add(c.id));
  return { edl, refined, refinedPath, sync: override.sync, targets };
}

export function runPinPage({ rk, flags, mediaFilterDir, dataFilterDir }) {
  if (!flags.src) throw new Error('pin-page needs --src <local media file>');
  const { edl, sync, targets } = load({ rk, mediaFilterDir, dataFilterDir });
  const dir = path.join(mediaFilterDir, 'refine', rk, 'pin');
  mkdirSync(dir, { recursive: true });
  const sections = [];
  for (const [n, c] of targets.entries()) {
    const [span] = mapSpan(c.in, c.out, sync);
    if (!span) continue;
    const c0 = Math.max(0, span.in - 1); const dur = span.out - span.in + 2;
    const file = `${String(n + 1).padStart(2, '0')}-${c.id}.mp4`;
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', c0.toFixed(3), '-i', flags.src, '-t', dur.toFixed(3), '-map', '0:v:0', '-map', '0:a:0',
      '-vf', 'scale=640:-2', '-c:v', 'libx264', '-crf', '24', '-preset', 'veryfast', '-c:a', 'aac', '-ac', '2', '-b:a', '128k', path.join(dir, file)]);
    sections.push(`<section data-id="${c.id}" data-start="${c0.toFixed(3)}"><h2>${n + 1}. "${esc(c.label)}" <small>${esc(c.category)}</small></h2>
<video src="${file}" controls preload="metadata"></video>
<div class="row"><button data-r="1">1x</button><button data-r="0.5">0.5x</button><button class="mark">Mark word</button><button class="none">Not spoken here</button><span class="got"></span></div></section>`);
  }
  const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pin words</title><style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#ddd;--ok:#2e7d32}@media (prefers-color-scheme:dark){:root{--bg:#151515;--fg:#eee;--muted:#aaa;--line:#333;--ok:#81c784}}
body{background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif;max-width:760px;margin:0 auto;padding:16px}section{border-top:1px solid var(--line);padding:14px 0}
h2{font-size:17px;margin:0 0 8px}small{color:var(--muted);font-weight:normal}video{width:100%;background:#000}.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}
.got{color:var(--ok)}#out{width:100%;height:160px;font:13px monospace}</style></head><body>
<h1>${esc(edl.title)}: pin the missed words</h1>
<p>Each clip covers the wide mute the player uses for a word the transcript missed. Play it (0.5x helps) and press <b>Mark word</b> just as the word starts, or <b>Not spoken here</b>. Then Copy results and paste them to Claude.</p>
${sections.join('\n')}
<section><button id="copy">Copy results</button><p><textarea id="out" readonly></textarea></p></section>
<script>
const marks={};
document.querySelectorAll('section[data-id]').forEach(s=>{const v=s.querySelector('video');const id=s.dataset.id;const got=s.querySelector('.got');
 s.querySelectorAll('[data-r]').forEach(b=>b.onclick=()=>{v.playbackRate=+b.dataset.r;v.play()});
 s.querySelector('.mark').onclick=()=>{const t=(+s.dataset.start+v.currentTime).toFixed(3);marks[id]=t;got.textContent='marked at '+t+' s'};
 s.querySelector('.none').onclick=()=>{marks[id]='none';got.textContent='not spoken here'};});
document.getElementById('copy').onclick=()=>{const o=document.getElementById('out');o.value=[...document.querySelectorAll('section[data-id]')].map(s=>s.dataset.id+': '+(marks[s.dataset.id]||'skip')).join('\\n');o.select();try{navigator.clipboard.writeText(o.value)}catch(e){}};
</script></body></html>`;
  writeFileSync(path.join(dir, 'index.html'), page);
  console.error(`${sections.length} clips -> ${path.join(dir, 'index.html')}`);
  return path.join(dir, 'index.html');
}

/**
 * Find each marked word's edges. A press lands ~0.15-0.35 s after the word
 * starts. Whisper (prompted with the word) transcribes 5 s around the press; a
 * hit counts only inside the press's reaction window, so a person has already
 * confirmed the word is there. The hit is timed like refine's words (forced
 * alignment, then an energy snap). Without a hit, the span from just before the
 * press to the next energy offset is kept as `pinned` (covers the word, not ms).
 * @param {{ src: string, items: Array<{ id: string, mark: number, prompt: string, match: Function }> }} p
 * @returns {Promise<Map<string, { start: number, end: number, precision: 'ms'|'pinned' }>>}
 */
export async function pinWords({ src, items }) {
  const out = new Map();
  if (!items.length) return out;
  const cmd = (process.env.CONTENT_FILTER_TRANSCRIBE_PY || 'uv run --script').split(/\s+/);
  const req = { src, items: items.map((x) => ({ id: x.id, prompt: x.prompt, windows: [[x.mark - 2.5, 5]] })) };
  const res = spawnSync(cmd[0], [...cmd.slice(1), path.join(HERE, 'relisten.py')], { input: JSON.stringify(req), maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] });
  const heard = res.status === 0 ? new Map(JSON.parse(res.stdout.toString()).items.map((i) => [i.id, i.windows[0]?.words || []])) : new Map();
  const media = new FfmpegRefineMedia();
  const aligner = new PythonWordAligner({ src });
  for (const x of items) {
    const words = heard.get(x.id) || [];
    // The press implies a start ~0.25 s before it; take the matching word nearest that.
    let hitIdx = -1;
    words.forEach((w, i) => {
      if (!x.match(w.w) || w.s < x.mark - 0.9 || w.s > x.mark + 0.2) return;
      if (hitIdx < 0 || Math.abs(w.s - (x.mark - 0.25)) < Math.abs(words[hitIdx].s - (x.mark - 0.25))) hitIdx = i;
    });
    let start; let end; let precision = 'ms';
    if (hitIdx >= 0) {
      start = words[hitIdx].s; end = words[hitIdx].e;
      const ctx = words.filter((w) => Math.abs(w.s - start) <= 2);
      const [a] = await aligner.align([{ id: x.id, t0: Math.max(0, ctx[0].s - 0.6), t1: ctx[ctx.length - 1].e + 0.6, words: ctx.map((w) => w.w), target: ctx.indexOf(words[hitIdx]) }]);
      if (a && !a.error && Math.abs(a.start - start) < 0.5) { start = a.start; end = a.end; }
    } else {
      precision = 'pinned';
      start = x.mark - 0.4; end = x.mark + 0.6;
    }
    const clip = await media.audio(src, start - 0.45, end + 0.45);
    if (precision === 'ms') {
      for (const [edge, kind] of [['start', 'onset'], ['end', 'offset']]) {
        const near = edge === 'start' ? start : end;
        const c = boundaryCandidates(clip, { kind, near, within: 0.07, max: 6 });
        if (c.length) { const t = c.reduce((p, q) => (q.strength > p.strength ? q : p)).t; if (edge === 'start') start = t; else end = t; }
      }
    } else {
      const off = boundaryCandidates(clip, { kind: 'offset', near: x.mark + 0.5, within: 0.5, max: 6 }).filter((c) => c.t > x.mark);
      if (off.length) end = Math.max(...off.map((c) => c.t));
    }
    if (end > start) out.set(x.id, { start, end, precision });
  }
  return out;
}

export async function runPin({ rk, flags, args, mediaFilterDir, dataFilterDir }) {
  if (!flags.src || !flags.marks) throw new Error('pin needs --src <file> and --marks <file>');
  const { refined, refinedPath, sync, targets } = load({ rk, mediaFilterDir, dataFilterDir });
  const byId = new Map(targets.map((c) => [c.id, c]));
  const marks = new Map(readFileSync(flags.marks, 'utf8').split('\n').map((l) => l.match(/^\s*(va\d+)\s*:\s*(\S+)/)).filter(Boolean).map((m) => [m[1], m[2]]));
  const at = new Date().toISOString().slice(0, 10);
  const none = new Set([...marks].filter(([id, v]) => byId.has(id) && v === 'none').map(([id]) => id));
  const items = [...marks].filter(([id, v]) => byId.has(id) && Number.isFinite(Number(v)))
    .map(([id, v]) => ({ id, mark: Number(v), prompt: wordPrompt(byId.get(id)) || byId.get(id).label.replace(/\*/g, ''), match: wordMatcher(byId.get(id)) || (() => false) }));
  const pinned = await pinWords({ src: flags.src, items });
  for (const [id, p] of pinned) console.error(`  ${id}: ${p.precision} ${ms(p.start)}–${ms(p.end)} s`);
  for (const id of none) console.error(`  ${id}: not spoken (stays a safe window, flagged)`);
  const cues = refined.cues.map((c) => {
    if (none.has(c.id)) return { ...c, pinned: { none: true, at } };
    const p = pinned.get(c.id);
    if (!p) return c;
    const { tagIn, tagOut, ...rest } = c;
    return { ...rest, in: ms(unmapTime(p.start, sync)), out: ms(unmapTime(p.end, sync)), precision: p.precision, refine: { v: 1, at, how: p.precision === 'ms' ? 'pinned/aligner' : 'pinned/press' } };
  });
  const certification = certify({ cues, certification: refined.certification }, { at });
  console.error(`${pinned.size} pinned (${[...pinned.values()].filter((p) => p.precision === 'ms').length} to ms); certification ${certification.level}`);
  if (!args.includes('--write')) { console.error('(dry run: pass --write)'); return; }
  writeFileSync(refinedPath, yaml.dump({ ...refined, cues, certification }, { lineWidth: 140 }));
  console.error(`✓ ${refinedPath}`);
}
