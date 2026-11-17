import { createHash } from 'node:crypto';
export const migrationHash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const fail = (code, message) => {
  throw Object.assign(Error(message), {
    code
  });
};
const copy = value => JSON.parse(JSON.stringify(value));

/** Read-only downgrade preview, also used by the durable backout transaction. */
export function exportLegacyPlan({
  plan,
  originalRules,
  originalRoster = originalRules.launch.participants,
  listCodec
}) {
  const rules = copy(originalRules),
    allowed = new Set(originalRoster);
  const ids = plan.participants.map(p => {
    if (!p.person) fail('unsupported_downgrade', 'Anonymous participants cannot be downgraded');
    const id = p.person.kind === 'guest' ? `guest:${p.person.id}` : p.person.id;
    if (p.person.kind === 'guest' && !allowed.has(id)) fail('unsupported_downgrade', 'New guest requires retained participant runtime');
    return id;
  });
  const settings = Object.values(plan.activity_settings);
  const definitionId = originalRules.artifact?.id ?? originalRules.id;
  if (definitionId && plan.list.sections.flatMap(section => section.items).some(item => plan.activity_settings[item.uid] && item.open !== `party-games/${definitionId}`)) fail('unsupported_downgrade', 'Selected activity targets a different legacy definition');
  if (settings.some(s => s.consumer.id !== 'party-games') || settings.some(s => JSON.stringify(s) !== JSON.stringify(settings[0]))) fail('unsupported_downgrade', 'Activity setup cannot be represented by legacy defaults');
  const setup = settings[0];
  if (setup && setup.participants.mode !== 'plan') fail('unsupported_downgrade', 'Explicit activity subsets cannot be downgraded');
  rules.launch = {
    ...rules.launch,
    participants: ids,
    ...(setup ? {
      autostart: setup.settings.autostart
    } : {})
  };
  if (setup) {
    const modes = plan.participants.map(p => setup.settings.charades.clue_modes[p.id] ?? setup.settings.charades.default_clue_mode);
    rules.presentation = {
      ...rules.presentation,
      reader_participants: ids.filter((_, i) => modes[i] === 'reader'),
      image_participants: ids.filter((_, i) => modes[i] === 'image')
    };
  }
  listCodec.validateEmbeddedList(plan.list);
  return {
    list: listCodec.serializeEmbeddedList(plan.list),
    rules
  };
}
