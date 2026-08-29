/**
 * Generate QR Code application operation
 *
 * Generates styled SVG QR codes with three modes:
 * - Raw: encode any string
 * - Content: resolve contentId metadata for label/logo
 * - Command: auto-detect barcode commands, use matching icon
 *
 * @module applications/qrcode/GenerateQRCode
 */
/**
 * @param {Object} config
 * @param {Object} config.renderer - QRCodeRenderer instance with renderSvg()
 * @param {Function} config.createContentExpression - Builds an expression from
 * domain-shaped values and returns an object with toString()
 * @param {Object} [config.contentIdResolver] - ContentIdResolver for content mode
 * @param {string} config.mediaPath - Path to media directory
 * @param {string} [config.defaultLogoPath] - Path to default logo (favicon)
 * @param {Object} [config.logger]
 */
export function createGenerateQRCode(config) {
  // `contentExpression` is INJECTED. A router may not import 2_domains
  // (api-layer-guidelines.md: "API has no domain knowledge"); it receives the
  // parser and calls fromQuery on it.
  const { createContentExpression, knownCommands = [] } = config;
  const { renderer, contentIdResolver, contentCatalog, assetGateway, defaultScreen, logger = console } = config;
  if (!assetGateway) throw new Error('createGenerateQRCode requires assetGateway');

  return async function generateQRCode(input) {
      const {
        data,
        content,
        options: optionsStr,
        screen,
        expression: expr,
        label: labelOverride,
        sublabel: sublabelOverride,
        logo: logoParam,
        size,
        style,
        fg,
        bg,
      } = input;

      const actionParams = expr.action ? (() => {
        const options = Object.keys(expr.options).filter(k => expr.options[k] === true);

        // Build encoded barcode string without default screen
        const encodeExpr = createContentExpression({
          screen: (expr.screen && expr.screen !== defaultScreen) ? expr.screen : null,
          action: expr.action,
          contentId: expr.contentId,
          options: expr.options,
        });

        return {
          action: expr.action,
          contentId: expr.contentId,
          screen: expr.screen || defaultScreen,
          options,
          encodeData: encodeExpr.toString(),
        };
      })() : null;

      let encodeData;
      let label = labelOverride || null;
      let sublabel = sublabelOverride || null;
      let logoData = null;
      let coverData = null;
      let coverAspect = 1;
      let optionBadges = [];
      if (actionParams) {
        // ── Action mode ──────────────────────────────────
        encodeData = actionParams.encodeData;

        // Resolve content metadata (thumbnail, labels)
        const result = await resolveContent({
          contentId: actionParams.contentId,
          options: actionParams.options.join('+') || null,
          screen: null, // screen is already baked into encodeData
          contentIdResolver, contentCatalog,
          assetGateway,
          logger,
        });

        // Use resolved labels but keep our own encodeData
        if (!label) label = result.label;
        if (!sublabel) sublabel = result.sublabel;
        if (result.logoData) {
          coverData = result.logoData;
          coverAspect = result.coverAspect || 1;
        }
        optionBadges = result.optionBadges || [];

      } else if (content) {
        // ── Content mode ──────────────────────────────────
        const result = await resolveContent({
          contentId: content,
          options: optionsStr,
          screen,
          contentIdResolver, contentCatalog,
          assetGateway,
          logger,
        });

        encodeData = result.encodeData;
        if (!label) label = result.label;
        if (!sublabel) sublabel = result.sublabel;
        // Content thumbnails use cover layout (side-by-side)
        if (result.logoData) {
          coverData = result.logoData;
          coverAspect = result.coverAspect || 1;
        }
        optionBadges = result.optionBadges || [];

      } else {
        // ── Raw / Command mode ────────────────────────────
        encodeData = data;

        // Normalize delimiters for command detection
        const normalized = data.replace(/[; ]/g, ':');
        const segments = normalized.split(':');

        // Check for command auto-detect
        const commandMatch = detectCommand(segments, knownCommands);
        if (commandMatch) {
          if (!label) label = commandMatch.label;
          logoData = await assetGateway.loadCommandIcon(commandMatch.command);
        }

        // Check for option badges in raw data
        const plusIdx = data.indexOf('+');
        if (plusIdx !== -1) {
          const opts = data.slice(plusIdx + 1).split('+').filter(Boolean);
          optionBadges = await assetGateway.loadOptionBadges(opts);
        }
      }

      // Load default logo if none resolved
      if (logoData === null && logoParam !== false) {
        logoData = await assetGateway.loadDefaultLogo();
      }

      const svg = renderer.renderSvg(encodeData, {
        size,
        style,
        fg,
        bg,
        label,
        sublabel,
        logoData: logoParam === false ? false : logoData,
        coverData: coverData,
        coverAspect: coverAspect,
        logo: logoParam !== false,
        optionBadges,
      });

      return svg;
  };
}

// ─── Helpers ─────────────────────────────────────────────

function detectCommand(segments, knownCommands) {
  if (segments.length === 1 && knownCommands.includes(segments[0])) {
    return { command: segments[0], label: segments[0].toUpperCase() };
  }
  if (segments.length === 2) {
    if (knownCommands.includes(segments[0])) {
      return { command: segments[0], label: `${segments[0].toUpperCase()} ${segments[1]}` };
    }
    if (knownCommands.includes(segments[1])) {
      return { command: segments[1], label: segments[1].toUpperCase() };
    }
  }
  if (segments.length === 3 && knownCommands.includes(segments[1])) {
    return { command: segments[1], label: `${segments[1].toUpperCase()} ${segments[2]}` };
  }
  return null;
}

async function resolveContent({ contentId, options, screen, contentIdResolver, contentCatalog, assetGateway, logger }) {
  let encodeData = contentId;
  let label = null;
  let sublabel = null;
  let logoData = null;
  let coverAspect = 1;
  let optionBadges = [];

  // Build encode string with screen prefix and options
  if (screen) encodeData = `${screen}:${encodeData}`;
  if (options) {
    encodeData = `${encodeData}+${options}`;
    const opts = options.split('+').filter(Boolean);
    optionBadges = await assetGateway.loadOptionBadges(opts);
  }

  if (!contentIdResolver || !contentCatalog) {
    return { encodeData, label, sublabel, logoData, coverAspect, optionBadges };
  }

  try {
    const resolved = contentIdResolver.resolve(contentId);
    if (!resolved) {
      logger.warn?.('qrcode.content.unresolved', { contentId });
      return { encodeData, label, sublabel, logoData, optionBadges };
    }

    const item = await contentCatalog.getItem(resolved);
    if (!item) {
      logger.warn?.('qrcode.content.notFound', { contentId });
      return { encodeData, label, sublabel, logoData, optionBadges };
    }

    const meta = item.metadata || {};
    const type = meta.type || item.itemType || 'unknown';

    switch (type) {
      case 'movie':
        label = item.title;
        sublabel = meta.year ? String(meta.year) : null;
        break;
      case 'episode':
        label = meta.grandparentTitle || item.title;
        sublabel = meta.parentIndex != null && meta.itemIndex != null
          ? `S${String(meta.parentIndex).padStart(2, '0')}E${String(meta.itemIndex).padStart(2, '0')} — ${item.title}`
          : item.title;
        break;
      case 'track':
        label = meta.album || meta.parentTitle || item.title;
        sublabel = meta.artist || meta.grandparentTitle || null;
        break;
      case 'album':
        label = item.title;
        sublabel = meta.artist || meta.grandparentTitle || meta.parentTitle || null;
        break;
      case 'artist':
        label = item.title;
        sublabel = meta.librarySectionTitle || null;
        break;
      default:
        label = item.title;
        sublabel = meta.parentTitle || null;
    }

    let thumbUrl = item.thumbnail || meta.thumbnail;

    // Fallback: for containers without thumbnails, try first child's thumbnail
    if (!thumbUrl && item.itemType === 'container') {
      try {
        const children = await contentCatalog.getList(resolved);
        if (children?.length > 0) {
          thumbUrl = children[0].thumbnail;
        }
      } catch { /* best effort */ }
    }

    if (thumbUrl) {
      const thumbResult = await assetGateway.fetchThumbnail(thumbUrl);
      if (thumbResult) {
        logoData = thumbResult.dataUri;
        coverAspect = thumbResult.aspect;
      }
    }

  } catch (err) {
    logger.warn?.('qrcode.content.error', { contentId, error: err.message });
  }

  return { encodeData, label, sublabel, logoData, coverAspect, optionBadges };
}
