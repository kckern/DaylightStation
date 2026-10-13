// Telegram scale prompt and keyboard presentation.
function chunk(arr, size) {
  const rows = [];
  for (let i = 0; i < arr.length; i += size) rows.push(arr.slice(i, i + size));
  return rows;
}

export function buildDensityKeyboard(cfg, encodeCallback, logUuid, opts = {}) {
  const showingHelp = opts.showingHelp === true;
  // UI shows emoji + word label only; the numeric level rides in the callback payload.
  const buttons = cfg.densityLevels.map((l) => ({
    text: `${l.emoji} ${l.label}`,
    callback_data: encodeCallback('sd', { id: logUuid, l: l.level }),
  }));
  const helpBtn = showingHelp
    ? { text: '⬅️ Back', callback_data: encodeCallback('sh', { id: logUuid, h: 0 }) }
    : { text: '❓ Help', callback_data: encodeCallback('sh', { id: logUuid, h: 1 }) };
  const controlRow = [
    { text: '📦 Container', callback_data: encodeCallback('st', { id: logUuid }) },
    helpBtn,
    { text: '❌ Cancel', callback_data: encodeCallback('x', { id: logUuid }) },
  ];
  return [...chunk(buttons, 3), controlRow]; // 3x3 grid + control row
}

export function buildContainerKeyboard(cfg, encodeCallback, logUuid) {
  const none = [{ text: '🚫 No container', callback_data: encodeCallback('st', { id: logUuid, c: 'none' }) }];
  // UI shows emoji + label only; the tare grams stays server-side, resolved from c.id.
  const containers = cfg.containers.items.map((c) => ({
    text: `${c.emoji} ${c.label}`,
    callback_data: encodeCallback('st', { id: logUuid, c: c.id }),
  }));
  return [none, ...chunk(containers, 3)];
}

export function densityPromptText(grams) {
  return `⚖️ ${grams} g`;
}

export function densityHelpText(cfg, grams) {
  const lines = cfg.densityLevels.map(
    (l) => `${l.emoji} ${l.label} · ${l.kcal_per_g} kcal/g${l.hint ? `  (${l.hint})` : ''}`,
  );
  return `⚖️ ${grams} g — tap a level or describe it\n\n${lines.join('\n')}`;
}

export function containerPromptText(grams) {
  return `⚖️ ${grams} g — in a container?\n\nPick one to subtract its weight, or "No container".`;
}
