const ID = /^[a-z][a-z0-9-]*$/;

/** Pure semantic and pixel lint for the reviewable TI-86 design system. */
export function lintSchoolCalcDesignSystem({ design, screens, type, icons } = {}) {
  const errors = [];
  const push = (message) => errors.push(message);
  if (design?.schema !== 'schoolcalc.design-system/v1') push('design schema must be schoolcalc.design-system/v1');
  if (screens?.schema !== 'schoolcalc.gui/v1') push('screen schema must be schoolcalc.gui/v1');
  if (type?.schema !== 'schoolcalc.type/v1') push('type schema must be schoolcalc.type/v1');
  if (icons?.schema !== 'schoolcalc.icons/v1') push('icon schema must be schoolcalc.icons/v1');
  if (errors.length) return report(errors, design, screens);

  const width = design.display?.width;
  const height = design.display?.height;
  if (width !== 128 || height !== 64) push('design display must be the physical 128x64 canvas');
  if (screens.screen_width !== width || screens.screen_height !== height || screens.pixel_scale !== 1) {
    push('screens must use one source cell per pixel on the complete design canvas');
  }
  validateRegions(design, push);

  const categories = new Set(design.component_categories ?? []);
  const components = uniqueRegistry(design.components, 'component', 'id', push);
  components.forEach((component, id) => {
    if (!categories.has(component.category)) push(`component '${id}' has unknown category '${component.category}'`);
  });
  const layouts = new Map(Object.entries(design.layout_profiles ?? {}));
  const templates = uniqueRegistry(design.templates, 'template', 'id', push);
  templates.forEach((template, id) => {
    if (!layouts.has(template.layout)) push(`template '${id}' has unknown layout '${template.layout}'`);
    if (!Array.isArray(template.required_components) || template.required_components.length === 0) {
      push(`template '${id}' must require components`);
    } else {
      template.required_components.forEach((component) => {
        if (!components.has(component)) push(`template '${id}' requires unknown component '${component}'`);
      });
    }
  });
  const iconIds = new Set((icons.icons ?? []).map(({ id }) => id));
  const allowedKeys = new Set(design.hardware_keys ?? []);
  const scrollModels = new Set(design.scroll_models ?? []);
  const forbiddenSoftkeys = new Set(design.forbidden_softkey_labels ?? []);
  const seenScreens = new Set();
  const coveredTemplates = new Set();

  if (!Array.isArray(screens.screens) || screens.screens.length === 0) push('screens must be non-empty');
  for (const screen of screens.screens ?? []) {
    const at = `screen '${screen?.id ?? '?'}'`;
    if (!ID.test(screen?.id || '') || seenScreens.has(screen.id)) push(`${at} has an invalid or duplicate id`);
    else seenScreens.add(screen.id);
    const template = templates.get(screen.template);
    if (!template) {
      push(`${at} has unknown template '${screen.template}'`);
      continue;
    }
    coveredTemplates.add(screen.template);
    if (screen.layout !== template.layout) {
      push(`${at} layout '${screen.layout}' does not match template '${template.layout}'`);
    }
    validateComponentComposition(screen, template, components, push);
    validateInteraction(screen, { allowedKeys, scrollModels, forbiddenSoftkeys, iconIds }, push);
    const bitmap = validateBitmap(screen, screens, width, height, push);
    if (bitmap) validateLayoutPixels(screen, bitmap, design, layouts.get(template.layout), push);
  }
  templates.forEach((_, templateId) => {
    if (!coveredTemplates.has(templateId)) push(`required template '${templateId}' has no golden screen`);
  });
  validateFontAndIconAssets(type, icons, push);
  return report(errors, design, screens, { coveredTemplates });
}

function validateRegions(design, push) {
  const expected = {
    header: [0, 0, 128, 8],
    header_margin: [0, 8, 128, 1],
    body: [0, 9, 128, 46],
    separator: [0, 55, 128, 1],
    softkeys: [0, 56, 128, 8],
    rail: [125, 9, 3, 46],
  };
  Object.entries(expected).forEach(([id, values]) => {
    const region = design.regions?.[id];
    if (!region || [region.x, region.y, region.width, region.height].some((value, index) => value !== values[index])) {
      push(`region '${id}' must remain ${values.join(',')}`);
    }
  });
  const slots = design.softkey_slots ?? [];
  if (slots.length !== 5 || slots.some((slot, index) => (
    slot.key !== `F${index + 1}` || !Number.isInteger(slot.x) || !Number.isInteger(slot.width)
  ))) push('softkey_slots must define fixed F1-F5 pixel spans');
}

function uniqueRegistry(values, kind, idField, push) {
  const out = new Map();
  if (!Array.isArray(values) || values.length === 0) {
    push(`${kind} registry must be non-empty`);
    return out;
  }
  values.forEach((value) => {
    const id = value?.[idField];
    if (typeof id !== 'string' || !id || out.has(id)) push(`${kind} id is missing or duplicated: '${id}'`);
    else out.set(id, value);
  });
  return out;
}

function validateComponentComposition(screen, template, components, push) {
  const at = `screen '${screen.id}'`;
  if (!Array.isArray(screen.components) || screen.components.length === 0) {
    push(`${at} must declare its component composition`);
    return;
  }
  if (new Set(screen.components).size !== screen.components.length) push(`${at} repeats a component`);
  screen.components.forEach((component) => {
    if (!components.has(component)) push(`${at} uses unknown component '${component}'`);
  });
  template.required_components.forEach((component) => {
    if (!screen.components.includes(component)) push(`${at} is missing required component '${component}'`);
  });
}

function validateInteraction(screen, contract, push) {
  const at = `screen '${screen.id}'`;
  const interaction = screen.interaction;
  if (!interaction || !contract.scrollModels.has(interaction.scroll_model)) {
    push(`${at} has invalid scroll_model '${interaction?.scroll_model}'`);
  }
  const keys = interaction?.hardware_keys;
  if (!Array.isArray(keys) || new Set(keys).size !== keys.length) push(`${at} hardware_keys must be a unique array`);
  else keys.forEach((key) => {
    if (!contract.allowedKeys.has(key)) push(`${at} uses unknown hardware key '${key}'`);
  });
  const softkeys = interaction?.softkeys;
  if (!Array.isArray(softkeys) || softkeys.length !== 5) {
    push(`${at} must declare exactly five fixed softkey slots`);
    return;
  }
  softkeys.forEach((softkey, index) => {
    if (softkey === null) return;
    if (!softkey || !ID.test(softkey.action || '')) push(`${at} F${index + 1} has invalid semantic action`);
    if (softkey.label && contract.forbiddenSoftkeys.has(softkey.label.toUpperCase())) {
      push(`${at} F${index + 1} duplicates hardware action '${softkey.label}'`);
    }
    if (softkey.icon && !contract.iconIds.has(softkey.icon)) {
      push(`${at} F${index + 1} uses unknown icon '${softkey.icon}'`);
    }
  });
}

function validateBitmap(screen, spec, width, height, push) {
  const at = `screen '${screen.id}'`;
  if (!Array.isArray(screen.pixels) || screen.pixels.length !== height) {
    push(`${at} must contain ${height} complete pixel rows`);
    return null;
  }
  const bitmap = [];
  screen.pixels.forEach((row, y) => {
    const cells = [...row];
    if (cells.length !== width) push(`${at} row ${y} has ${cells.length} pixels; expected ${width}`);
    if (cells.some((cell) => cell !== spec.blank && cell !== spec.filled)) push(`${at} row ${y} contains an invalid pixel`);
    bitmap.push(cells.map((cell) => cell === spec.filled));
  });
  return bitmap;
}

function validateLayoutPixels(screen, bitmap, design, profile, push) {
  const at = `screen '${screen.id}'`;
  if (!profile) return;
  const headerDensity = density(bitmap, 0, 0, 128, 8);
  const marginDensity = density(bitmap, 0, 8, 128, 1);
  const separatorDensity = density(bitmap, 0, 55, 128, 1);
  if (profile.header === 'required' && headerDensity < 0.65) push(`${at} is missing the inverted sticky header`);
  if (profile.header === 'forbidden' && headerDensity > 0.35) push(`${at} full-frame layout contains header chrome`);
  if (profile.header_margin === 'required' && marginDensity !== 0) push(`${at} must preserve the blank y=8 header margin`);
  if (profile.separator === 'required' && separatorDensity !== 1) push(`${at} must preserve the complete y=55 softkey separator`);
  if (profile.separator === 'forbidden' && separatorDensity === 1) push(`${at} full-frame layout contains a softkey separator`);

  const softkeys = screen.interaction.softkeys;
  const softkeyAnchor = profile.softkey_anchor ?? 'filled';
  design.softkey_slots.forEach((slot, index) => {
    const slotDensity = density(bitmap, slot.x, 56, slot.width, 8);
    const minimumDensity = softkeyAnchor === 'sparse' ? 0.04 : 0.5;
    if (softkeys[index] && slotDensity < minimumDensity) push(`${at} F${index + 1} assigned slot is not visibly anchored`);
    if (!softkeys[index] && slotDensity !== 0) push(`${at} F${index + 1} is visually occupied but semantically empty`);
  });
  if (profile.softkeys === 'forbidden' && softkeys.some(Boolean)) push(`${at} full-frame layout assigns softkeys`);
  if (profile.body_frames === 'forbidden') {
    const frame = findBodyFrame(bitmap);
    if (frame) push(`${at} boxes ordinary body content at ${frame.join(',')}`);
  }
  if (screen.template === 'confirmation') validateConfirmationBounds(bitmap, at, push);
  if (screen.template === 'qr') validateSchoolActionQr(bitmap, design.qr_profiles?.school_action, at, push);
  if (screen.template === 'qr-output') validateResultOutputQr(bitmap, design.qr_profiles?.result_output, at, push);
}

function validateConfirmationBounds(bitmap, at, push) {
  const frame = findBodyFrame(bitmap);
  if (!frame) {
    push(`${at} must contain one visible confirmation frame`);
    return;
  }
  const [left, top, width, height] = frame;
  const right = left + width - 1;
  const bottom = top + height - 1;
  for (let y = top + 1; y < bottom; y += 1) {
    for (let x = 0; x < 128; x += 1) {
      if ((x < left || x > right) && bitmap[y][x]) {
        push(`${at} content escapes the confirmation frame at ${x},${y}`);
        return;
      }
    }
  }
}

function density(bitmap, x, y, width, height) {
  let filled = 0;
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) if (bitmap[yy]?.[xx]) filled += 1;
  }
  return filled / (width * height);
}

function findBodyFrame(bitmap) {
  const runs = new Map();
  for (let y = 9; y <= 54; y += 1) {
    const rowRuns = [];
    let start = null;
    for (let x = 0; x <= 128; x += 1) {
      if (x < 128 && bitmap[y][x]) {
        if (start === null) start = x;
      } else if (start !== null) {
        if (x - start >= 40) rowRuns.push([start, x - 1]);
        start = null;
      }
    }
    runs.set(y, rowRuns);
  }
  for (let top = 9; top <= 46; top += 1) {
    for (const [left, right] of runs.get(top)) {
      for (let bottom = top + 8; bottom <= 54; bottom += 1) {
        if (!runs.get(bottom).some(([a, b]) => a === left && b === right)) continue;
        let vertical = true;
        for (let y = top; y <= bottom; y += 1) {
          if (!bitmap[y][left] || !bitmap[y][right]) { vertical = false; break; }
        }
        if (vertical) return [left, top, right - left + 1, bottom - top + 1];
      }
    }
  }
  return null;
}

function validateSchoolActionQr(bitmap, profile, at, push) {
  if (!profile || profile.modules !== 21 || profile.scale !== 2 || profile.quiet_zone_modules !== 4) {
    push('school_action QR profile must remain Version 1 at 2x with a four-module quiet zone');
    return;
  }
  const full = (profile.modules + 2 * profile.quiet_zone_modules) * profile.scale;
  const dataLeft = Math.floor((128 - full) / 2) + profile.quiet_zone_modules * profile.scale;
  const dataTop = Math.floor((64 - full) / 2) + profile.quiet_zone_modules * profile.scale;
  const dataSize = profile.modules * profile.scale;
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 128; x += 1) {
      const inside = x >= dataLeft && x < dataLeft + dataSize && y >= dataTop && y < dataTop + dataSize;
      if (!inside && bitmap[y][x]) push(`${at} places pixels inside the required QR quiet/full-frame background`);
    }
  }
  for (let moduleY = 0; moduleY < profile.modules; moduleY += 1) {
    for (let moduleX = 0; moduleX < profile.modules; moduleX += 1) {
      const expected = bitmap[dataTop + moduleY * 2][dataLeft + moduleX * 2];
      for (let yy = 0; yy < 2; yy += 1) for (let xx = 0; xx < 2; xx += 1) {
        if (bitmap[dataTop + moduleY * 2 + yy][dataLeft + moduleX * 2 + xx] !== expected) {
          push(`${at} contains a nonuniform 2x QR module at ${moduleX},${moduleY}`);
        }
      }
    }
  }
}

function validateResultOutputQr(bitmap, profile, at, push) {
  if (!profile || profile.modules !== 37 || profile.scale !== 1
    || profile.quiet_zone_modules !== 4 || profile.rail !== 'sparse'
    || profile.origin?.x !== 45 || profile.origin?.y !== 13) {
    push('result_output QR profile must remain Version 5/M at 45,13 with a four-module quiet zone and sparse rail');
    return;
  }
  const left = profile.origin.x;
  const top = profile.origin.y;
  const quiet = profile.quiet_zone_modules;
  for (let y = top - quiet; y < top + profile.modules + quiet; y += 1) {
    for (let x = left - quiet; x < left + profile.modules + quiet; x += 1) {
      const inside = x >= left && x < left + profile.modules && y >= top && y < top + profile.modules;
      if (!inside && bitmap[y]?.[x]) {
        push(`${at} places pixels in the required result-QR quiet zone at ${x},${y}`);
        return;
      }
    }
  }
}

function validateFontAndIconAssets(type, icons, push) {
  const fontIds = new Set();
  for (const font of type.fonts ?? []) {
    if (!font.id || fontIds.has(font.id)) push(`font id is missing or duplicated: '${font.id}'`);
    fontIds.add(font.id);
    Object.entries(font.glyphs ?? {}).forEach(([glyph, rows]) => {
      validateRows(rows, font.width, font.height, type, `font '${font.id}' glyph '${glyph}'`, push);
    });
    if (font.proportional !== undefined && typeof font.proportional !== 'boolean') {
      push(`font '${font.id}' proportional flag must be boolean`);
    }
    Object.entries(font.glyph_advances ?? {}).forEach(([glyph, advance]) => {
      if (!font.proportional || !font.glyphs?.[glyph]
        || !Number.isInteger(advance) || advance < 1 || advance > font.advance_x) {
        push(`font '${font.id}' glyph '${glyph}' has an invalid proportional advance`);
      }
    });
    Object.entries(font.descender_rows ?? {}).forEach(([glyph, row]) => {
      if (!font.glyphs?.[glyph]) push(`font '${font.id}' descender '${glyph}' has no base glyph`);
      validateRows([row], font.width, 1, type, `font '${font.id}' descender '${glyph}'`, push);
    });
  }
  for (const required of ['compact-3x5', 'reader-4x6', 'display-5x7']) {
    if (!fontIds.has(required)) push(`required font '${required}' is missing`);
  }
  const iconIds = new Set();
  for (const icon of icons.icons ?? []) {
    if (!icon.id || iconIds.has(icon.id)) push(`icon id is missing or duplicated: '${icon.id}'`);
    iconIds.add(icon.id);
    validateRows(icon.pixels, icons.icon_width, icons.icon_height, icons, `icon '${icon.id}'`, push);
  }
}

function validateRows(rows, width, height, spec, at, push) {
  if (!Array.isArray(rows) || rows.length !== height) { push(`${at} must contain ${height} rows`); return; }
  rows.forEach((row, index) => {
    if ([...row].length !== width) push(`${at} row ${index} must contain ${width} pixels`);
    if ([...row].some((cell) => cell !== spec.blank && cell !== spec.filled)) push(`${at} row ${index} has an invalid pixel`);
  });
}

function report(errors, design, screens, { coveredTemplates = new Set() } = {}) {
  return {
    schema: 'schoolcalc.design-system-lint/v1',
    ok: errors.length === 0,
    errors,
    summary: {
      components: design?.components?.length ?? 0,
      templates: design?.templates?.length ?? 0,
      coveredTemplates: coveredTemplates.size,
      screens: screens?.screens?.length ?? 0,
    },
  };
}

export default lintSchoolCalcDesignSystem;
