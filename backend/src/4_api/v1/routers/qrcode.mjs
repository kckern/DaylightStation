/**
 * QR Code API Router
 *
 * Generates styled SVG QR codes with three modes:
 * - Raw: encode any string
 * - Content: resolve contentId metadata for label/logo
 * - Command: auto-detect barcode commands, use matching icon
 *
 * @module api/v1/routers/qrcode
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import imageSize from 'image-size';
import { KNOWN_COMMANDS } from '#domains/barcode/BarcodeCommandMap.mjs';

const COMMAND_ICON_MAP = {
  pause: 'pause.svg',
  play: 'play.svg',
  next: 'next.svg',
  prev: 'prev.svg',
  ffw: 'ffw.svg',
  rew: 'rew.svg',
  stop: 'stop.svg',
  off: 'off.svg',
  blackout: 'blackout.svg',
  volume: 'vol_up.svg',
  speed: 'speed.svg',
};

const OPTION_ICON_MAP = {
  shuffle: 'shuffle.svg',
  continuous: 'continuous.svg',
};

const ACTION_KEYS = ['queue', 'play', 'open'];
const KNOWN_PARAMS = new Set([
  ...ACTION_KEYS, 'data', 'content', 'options', 'screen',
  'label', 'sublabel', 'logo', 'size', 'style', 'fg', 'bg',
]);

/**
 * @param {Object} config
 * @param {Object} config.renderer - QRCodeRenderer instance with renderSvg()
 * @param {Object} [config.contentIdResolver] - ContentIdResolver for content mode
 * @param {string} config.mediaPath - Path to media directory
 * @param {string} [config.defaultLogoPath] - Path to default logo (favicon)
 * @param {Object} [config.logger]
 */
export function createQRCodeRouter(config) {
  const { renderer, contentIdResolver, mediaPath, defaultLogoPath, defaultScreen, logger = console } = config;
  const router = express.Router();

  const buttonsDir = path.join(mediaPath, 'img/buttons');

  /**
   * GET /api/v1/qrcode
   */
  router.get('/', async (req, res) => {
    try {
      const {
        data,
        content,
        options: optionsStr,
        screen,
        label: labelOverride,
        sublabel: sublabelOverride,
        logo: logoParam,
        size: sizeParam,
        style,
        fg,
        bg,
      } = req.query;

      // Check for action-based params first
      const actionParams = parseActionParams(req.query, defaultScreen);

      if (!data && !content && !actionParams) {
        return res.status(400).json({ error: 'Provide an action (queue, play, open), "content", or "data" query param' });
      }

      let encodeData;
      let label = labelOverride || null;
      let sublabel = sublabelOverride || null;
      let logoData = null;
      let coverData = null;
      let coverAspect = 1;
      let optionBadges = [];
      const size = sizeParam ? parseInt(sizeParam, 10) : undefined;

      if (actionParams) {
        // ── Action mode ──────────────────────────────────
        encodeData = actionParams.encodeData;

        // Resolve content metadata (thumbnail, labels)
        const result = await resolveContent({
          contentId: actionParams.contentId,
          options: actionParams.options.join('+') || null,
          screen: null, // screen is already baked into encodeData
          contentIdResolver,
          mediaPath,
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
          contentIdResolver,
          mediaPath,
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
        const commandMatch = detectCommand(segments);
        if (commandMatch) {
          if (!label) label = commandMatch.label;
          logoData = loadCommandIcon(commandMatch.command, buttonsDir);
        }

        // Check for option badges in raw data
        const plusIdx = data.indexOf('+');
        if (plusIdx !== -1) {
          const opts = data.slice(plusIdx + 1).split('+').filter(Boolean);
          optionBadges = loadOptionBadges(opts, buttonsDir);
        }
      }

      // Load default logo if none resolved
      if (logoData === null && logoParam !== 'false') {
        logoData = loadDefaultLogo(defaultLogoPath || path.join(mediaPath, 'img/favicon.ico'));
      }

      const svg = renderer.renderSvg(encodeData, {
        size,
        style,
        fg,
        bg,
        label,
        sublabel,
        logoData: logoParam === 'false' ? false : logoData,
        coverData: coverData,
        coverAspect: coverAspect,
        logo: logoParam !== 'false',
        optionBadges,
      });

      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(svg);

    } catch (err) {
      logger.error?.('qrcode.render.failed', { error: err.message });
      res.status(500).json({ error: 'QR code generation failed' });
    }
  });

  return router;
}

// ─── Helpers ─────────────────────────────────────────────

function detectCommand(segments) {
  if (segments.length === 1 && KNOWN_COMMANDS.includes(segments[0])) {
    return { command: segments[0], label: segments[0].toUpperCase() };
  }
  if (segments.length === 2) {
    if (KNOWN_COMMANDS.includes(segments[0])) {
      return { command: segments[0], label: `${segments[0].toUpperCase()} ${segments[1]}` };
    }
    if (KNOWN_COMMANDS.includes(segments[1])) {
      return { command: segments[1], label: segments[1].toUpperCase() };
    }
  }
  if (segments.length === 3 && KNOWN_COMMANDS.includes(segments[1])) {
    return { command: segments[1], label: `${segments[1].toUpperCase()} ${segments[2]}` };
  }
  return null;
}

function loadCommandIcon(command, buttonsDir) {
  const iconFile = COMMAND_ICON_MAP[command];
  if (!iconFile) return null;
  const iconPath = path.join(buttonsDir, iconFile);
  try {
    const svgContent = fs.readFileSync(iconPath, 'utf-8');
    return `data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}`;
  } catch {
    return null;
  }
}

function loadOptionBadges(opts, buttonsDir) {
  const badges = [];
  for (const opt of opts) {
    const key = opt.split('=')[0];
    const iconFile = OPTION_ICON_MAP[key];
    if (!iconFile) continue;
    const iconPath = path.join(buttonsDir, iconFile);
    try {
      const svgContent = fs.readFileSync(iconPath, 'utf-8');
      const pathMatch = svgContent.match(/<path[^>]*d="([^"]*)"[^>]*\/>/);
      if (pathMatch) badges.push(pathMatch[1]);
    } catch {
      // Skip missing icons
    }
  }
  return badges;
}

function loadDefaultLogo(logoPath) {
  try {
    const buf = fs.readFileSync(logoPath);
    const ext = path.extname(logoPath).slice(1);
    const mime = ext === 'ico' ? 'image/x-icon' : ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Parse action-based query params into content resolution inputs.
 * Detects queue/play/open action, extracts bare-key options, builds encode string.
 *
 * @param {Object} query - Express req.query
 * @param {string|null} defaultScreen - Default screen from devices.yml
 * @returns {{ action, contentId, screen, options, encodeData } | null}
 */
function parseActionParams(query, defaultScreen) {
  let action = null;
  let contentId = null;

  for (const key of ACTION_KEYS) {
    if (query[key] != null && query[key] !== '') {
      action = key;
      contentId = query[key];
      break;
    }
  }

  if (!action) return null;

  // Extract bare-key options (query params not in KNOWN_PARAMS with empty/missing value)
  const options = [];
  for (const [key, value] of Object.entries(query)) {
    if (KNOWN_PARAMS.has(key)) continue;
    if (value === '' || value === undefined) {
      options.push(key);
    }
  }

  // Determine screen: explicit param > default from config
  const screen = query.screen || null;

  // Build encoded barcode string: [screen:]action:contentId[+opt1+opt2]
  let encodeData = `${action}:${contentId}`;
  if (options.length > 0) encodeData += `+${options.join('+')}`;
  // Only prepend screen if explicitly provided and differs from default
  if (screen && screen !== defaultScreen) {
    encodeData = `${screen}:${encodeData}`;
  }

  return { action, contentId, screen: screen || defaultScreen, options, encodeData };
}

async function resolveContent({ contentId, options, screen, contentIdResolver, mediaPath, logger }) {
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
    const buttonsDir = path.join(mediaPath, 'img/buttons');
    optionBadges = loadOptionBadges(opts, buttonsDir);
  }

  if (!contentIdResolver) {
    return { encodeData, label, sublabel, logoData, coverAspect, optionBadges };
  }

  try {
    const resolved = contentIdResolver.resolve(contentId);
    if (!resolved?.adapter) {
      logger.warn?.('qrcode.content.unresolved', { contentId });
      return { encodeData, label, sublabel, logoData, optionBadges };
    }

    const item = await resolved.adapter.getItem(resolved.localId);
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
    if (!thumbUrl && item.itemType === 'container' && resolved.adapter.getList) {
      try {
        const children = await resolved.adapter.getList(resolved.localId);
        if (children?.length > 0) {
          thumbUrl = children[0].thumbnail;
        }
      } catch { /* best effort */ }
    }

    if (thumbUrl) {
      const thumbResult = await fetchThumbnailAsBase64(thumbUrl, logger);
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

async function fetchThumbnailAsBase64(url, logger) {
  try {
    const baseUrl = `http://localhost:${process.env.PORT || 3111}`;
    const fullUrl = url.startsWith('/') ? `${baseUrl}${url}` : url;
    const response = await fetch(fullUrl);
    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const dataUri = `data:${contentType};base64,${buffer.toString('base64')}`;

    // Detect aspect ratio from image buffer
    let aspect = 1;
    try {
      const dims = imageSize(buffer);
      if (dims.width && dims.height) {
        aspect = dims.width / dims.height;
      }
    } catch { /* default to square */ }

    return { dataUri, aspect };
  } catch (err) {
    logger.debug?.('qrcode.thumbnail.fetchFailed', { url, error: err.message });
    return null;
  }
}
