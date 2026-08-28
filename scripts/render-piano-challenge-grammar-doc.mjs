/** Render the generated portion of the PianoChallenge reference from AXES/PRESETS. */
import { AXES, PRESETS } from '../frontend/src/modules/Piano/ask/askSchema.js';

const values = (value) => Array.isArray(value) ? value.map((item) => `\`${item}\``).join(' · ') : null;

export function renderPianoChallengeGrammar() {
  const lines = [
    '<!-- generated:start — scripts/render-piano-challenge-grammar-doc.mjs -->',
    '## Grammar reference',
    '',
    '| Axis | Allowed values |',
    '| --- | --- |',
  ];
  for (const [axis, vocabulary] of Object.entries(AXES)) {
    if (axis === 'source') {
      const source = Object.entries(vocabulary)
        .map(([kind, descriptor]) => `\`${kind}\` (${descriptor.params.map((param) => `\`${param}\``).join(', ')})`)
        .join(' · ');
      lines.push(`| ${axis} | ${source} |`);
    } else lines.push(`| ${axis} | ${values(vocabulary)} |`);
  }
  lines.push('', '### Presets', '', '| Preset | Expansion |', '| --- | --- |');
  for (const [name, preset] of Object.entries(PRESETS)) {
    lines.push(`| \`${name}\` | ${Object.entries(preset).map(([key, value]) => `\`${key}: ${value}\``).join(', ')} |`);
  }
  lines.push('', '<!-- generated:end -->', '');
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(renderPianoChallengeGrammar());
