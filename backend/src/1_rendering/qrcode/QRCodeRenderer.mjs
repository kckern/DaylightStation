/**
 * QRCodeRenderer - Generates styled SVG QR codes.
 *
 * Two layouts:
 * - **Cover layout** (when coverData provided): cover image left, QR right, labels in frame below
 * - **Centered layout** (default): QR with optional center logo, labels in frame below
 *
 * Both layouts use a thick colored frame with white content area inset.
 *
 * @module rendering/qrcode/QRCodeRenderer
 */

import QRCode from 'qrcode';
import { qrcodeTheme } from './qrcodeTheme.mjs';

/**
 * Create a QR code renderer.
 * @param {Object} [config]
 * @param {string} [config.mediaPath] - Path to media directory
 * @returns {{ renderSvg: (data: string, options?: Object) => string }}
 */
export function createQRCodeRenderer(config = {}) {
  const theme = qrcodeTheme;

  function renderSvg(data, options = {}) {
    const coverData = options.coverData || null;
    if (coverData) {
      return renderCoverLayout(data, options, theme);
    }
    return renderCenteredLayout(data, options, theme);
  }

  return { renderSvg };
}

// ─── Cover Layout: image left, QR right, labels in frame ────────

function renderCoverLayout(data, options, theme) {
  const size = options.size || theme.qr.size;
  const style = options.style || 'dots';
  const fg = options.fg || theme.colors.foreground;
  const bg = options.bg || theme.colors.background;
  const padding = theme.qr.margin;
  const frame = theme.frame.width;
  const label = options.label || null;
  const sublabel = options.sublabel || null;
  const coverData = options.coverData;
  const logoData = options.logoData || null;
  const optionBadges = options.optionBadges || [];

  // Generate QR matrix
  const qr = QRCode.create(data, { errorCorrectionLevel: theme.qr.errorCorrection });
  const modules = qr.modules;
  const moduleCount = modules.size;
  const moduleSize = size / moduleCount;

  // Layout dimensions
  const coverAspect = options.coverAspect || 1;
  const coverWidth = Math.round(size * coverAspect);
  const gap = padding;
  const contentWidth = coverWidth + gap + size;
  const labelHeight = label ? theme.label.height : 0;

  const totalWidth = frame + padding + contentWidth + padding + frame;
  const totalHeight = frame + padding + size + padding + labelHeight + frame;

  const parts = [];

  // SVG header
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">`);

  // Outer frame (dark rectangle)
  parts.push(`<rect width="${totalWidth}" height="${totalHeight}" rx="${theme.frame.borderRadius}" fill="${theme.frame.color}"/>`);

  // Inner white content area
  const innerX = frame;
  const innerY = frame;
  const innerW = totalWidth - frame * 2;
  const innerH = padding + size + padding;
  parts.push(`<rect x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" rx="${theme.frame.borderRadius - 4}" fill="${bg}"/>`);

  // Cover image (left side)
  const coverX = frame + padding;
  const coverY = frame + padding;
  parts.push(`<defs><clipPath id="cover-clip"><rect x="${coverX}" y="${coverY}" width="${coverWidth}" height="${size}" rx="8"/></clipPath></defs>`);
  parts.push(`<image href="${escapeAttr(coverData)}" x="${coverX}" y="${coverY}" width="${coverWidth}" height="${size}" clip-path="url(#cover-clip)" preserveAspectRatio="xMidYMid slice"/>`);

  // QR code (right side)
  const qrX = frame + padding + coverWidth + gap;
  const qrY = frame + padding;
  const centerX = size / 2;
  const centerY = size / 2;
  const logoRadius = logoData ? (size * theme.logo.sizeRatio) / 2 : 0;

  parts.push(`<g transform="translate(${qrX}, ${qrY})">`);
  renderQRModules(parts, modules, moduleCount, moduleSize, size, style, fg, bg, theme, logoRadius, centerX, centerY);
  renderFinderPattern(parts, 0, 0, moduleSize, fg, bg);
  renderFinderPattern(parts, 0, moduleCount - 7, moduleSize, fg, bg);
  renderFinderPattern(parts, moduleCount - 7, 0, moduleSize, fg, bg);
  if (logoData) {
    renderLogo(parts, logoData, centerX, centerY, logoRadius, theme, bg, 'cover-logo-clip');
  }
  parts.push('</g>');

  // Label area
  if (label) {
    renderLabelBox(parts, { totalWidth, frame, innerH, labelHeight, padding, label, sublabel, optionBadges, theme });
  }

  parts.push('</svg>');
  return parts.join('\n');
}

// ─── Centered Layout: QR with optional center logo ──────────────

function renderCenteredLayout(data, options, theme) {
  const size = options.size || theme.qr.size;
  const style = options.style || 'dots';
  const fg = options.fg || theme.colors.foreground;
  const bg = options.bg || theme.colors.background;
  const padding = theme.qr.margin;
  const frame = theme.frame.width;
  const logoEnabled = options.logo !== false;
  const logoData = options.logoData || null;
  const label = options.label || null;
  const sublabel = options.sublabel || null;
  const optionBadges = options.optionBadges || [];

  // Generate QR matrix
  const qr = QRCode.create(data, { errorCorrectionLevel: theme.qr.errorCorrection });
  const modules = qr.modules;
  const moduleCount = modules.size;
  const moduleSize = size / moduleCount;

  const labelHeight = label ? theme.label.height : 0;
  const totalWidth = frame + padding + size + padding + frame;
  const totalHeight = frame + padding + size + padding + labelHeight + frame;

  const logoRadius = logoEnabled ? (size * theme.logo.sizeRatio) / 2 : 0;
  const centerX = size / 2;
  const centerY = size / 2;

  const parts = [];

  // SVG header
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">`);

  // Outer frame
  parts.push(`<rect width="${totalWidth}" height="${totalHeight}" rx="${theme.frame.borderRadius}" fill="${theme.frame.color}"/>`);

  // Inner white area
  const innerX = frame;
  const innerY = frame;
  const innerW = totalWidth - frame * 2;
  const innerH = padding + size + padding;
  parts.push(`<rect x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" rx="${theme.frame.borderRadius - 4}" fill="${bg}"/>`);

  // QR code
  parts.push(`<g transform="translate(${frame + padding}, ${frame + padding})">`);
  renderQRModules(parts, modules, moduleCount, moduleSize, size, style, fg, bg, theme, logoEnabled ? logoRadius : 0, centerX, centerY);
  renderFinderPattern(parts, 0, 0, moduleSize, fg, bg);
  renderFinderPattern(parts, 0, moduleCount - 7, moduleSize, fg, bg);
  renderFinderPattern(parts, moduleCount - 7, 0, moduleSize, fg, bg);

  if (logoEnabled && logoData) {
    renderLogo(parts, logoData, centerX, centerY, logoRadius, theme, bg, 'logo-clip');
  } else if (logoEnabled) {
    parts.push(`<circle cx="${centerX.toFixed(2)}" cy="${centerY.toFixed(2)}" r="${(logoRadius + theme.logo.padding).toFixed(2)}" fill="${bg}"/>`);
  }
  parts.push('</g>');

  // Label area
  if (label) {
    renderLabelBox(parts, { totalWidth, frame, innerH, labelHeight, padding, label, sublabel, optionBadges, theme });
  }

  parts.push('</svg>');
  return parts.join('\n');
}

// ─── Shared Helpers ─────────────────────────────────────────────

function renderLabelBox(parts, { totalWidth, frame, innerH, labelHeight, padding, label, sublabel, optionBadges, theme }) {
  const boxGap = 4;
  const boxX = frame;
  const boxY = frame + innerH + boxGap;
  const boxW = totalWidth - frame * 2;
  const boxH = labelHeight + frame - boxGap;
  const boxRadius = 8;

  // White rounded box
  parts.push(`<rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="${boxRadius}" fill="#ffffff"/>`);

  // Text centered within the box
  const textBlockHeight = sublabel ? theme.label.fontSize + theme.label.lineSpacing : theme.label.fontSize;
  const labelY = boxY + (boxH - textBlockHeight) / 2 + theme.label.fontSize;

  parts.push(`<text x="${totalWidth / 2}" y="${labelY}" text-anchor="middle" font-family="${theme.label.fontFamily}" font-size="${theme.label.fontSize}" font-weight="bold" fill="#000000">${escapeXml(label)}</text>`);

  if (sublabel) {
    const sublabelY = labelY + theme.label.lineSpacing;
    parts.push(`<text x="${totalWidth / 2}" y="${sublabelY}" text-anchor="middle" font-family="${theme.label.fontFamily}" font-size="${theme.label.sublabelFontSize}" fill="#666666">${escapeXml(sublabel)}</text>`);
  }

  // Option badges — far right inside box
  if (optionBadges.length > 0) {
    const badgeY = labelY;
    optionBadges.forEach((pathData, i) => {
      const bx = boxX + boxW - padding - (optionBadges.length - i) * (theme.badge.iconSize + theme.badge.gap);
      parts.push(`<g transform="translate(${bx}, ${badgeY - theme.badge.iconSize}) scale(${(theme.badge.iconSize / 24).toFixed(3)})"><path d="${pathData}" fill="#666666"/></g>`);
    });
  }
}

function renderQRModules(parts, modules, moduleCount, moduleSize, size, style, fg, bg, theme, logoRadius, centerX, centerY) {
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (!modules.get(row, col)) continue;
      if (isFinderPattern(row, col, moduleCount)) continue;

      const x = col * moduleSize + moduleSize / 2;
      const y = row * moduleSize + moduleSize / 2;

      if (logoRadius > 0) {
        const dx = x - centerX;
        const dy = y - centerY;
        if (Math.sqrt(dx * dx + dy * dy) < logoRadius + theme.logo.padding) continue;
      }

      if (style === 'dots') {
        const r = (moduleSize / 2) * theme.qr.dotScale;
        parts.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r.toFixed(2)}" fill="${fg}"/>`);
      } else {
        const rectSize = moduleSize * theme.qr.dotScale;
        const offset = (moduleSize - rectSize) / 2;
        parts.push(`<rect class="module" x="${(col * moduleSize + offset).toFixed(2)}" y="${(row * moduleSize + offset).toFixed(2)}" width="${rectSize.toFixed(2)}" height="${rectSize.toFixed(2)}" fill="${fg}"/>`);
      }
    }
  }
}

function renderLogo(parts, logoData, centerX, centerY, logoRadius, theme, bg, clipId) {
  const logoSize = logoRadius * 2;
  const logoX = centerX - logoRadius;
  const logoY = centerY - logoRadius;

  parts.push(`<circle cx="${centerX.toFixed(2)}" cy="${centerY.toFixed(2)}" r="${(logoRadius + theme.logo.padding).toFixed(2)}" fill="${bg}"/>`);
  parts.push(`<defs><clipPath id="${clipId}"><circle cx="${centerX.toFixed(2)}" cy="${centerY.toFixed(2)}" r="${logoRadius.toFixed(2)}"/></clipPath></defs>`);
  parts.push(`<image href="${escapeAttr(logoData)}" x="${logoX.toFixed(2)}" y="${logoY.toFixed(2)}" width="${logoSize.toFixed(2)}" height="${logoSize.toFixed(2)}" clip-path="url(#${clipId})" preserveAspectRatio="xMidYMid slice"/>`);
}

function isFinderPattern(row, col, moduleCount) {
  if (row < 7 && col < 7) return true;
  if (row < 7 && col >= moduleCount - 7) return true;
  if (row >= moduleCount - 7 && col < 7) return true;
  return false;
}

function renderFinderPattern(parts, startRow, startCol, moduleSize, fg, bg) {
  const { outerRadius, innerRadius } = qrcodeTheme.finder;
  const x = startCol * moduleSize;
  const y = startRow * moduleSize;
  const outerSize = 7 * moduleSize;
  const midSize = 5 * moduleSize;
  const innerSize = 3 * moduleSize;
  const midOffset = moduleSize;
  const innerOffset = 2 * moduleSize;

  parts.push(`<rect class="finder" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${outerSize.toFixed(2)}" height="${outerSize.toFixed(2)}" rx="${outerRadius}" fill="${fg}"/>`);
  parts.push(`<rect x="${(x + midOffset).toFixed(2)}" y="${(y + midOffset).toFixed(2)}" width="${midSize.toFixed(2)}" height="${midSize.toFixed(2)}" rx="${innerRadius}" fill="${bg}"/>`);
  parts.push(`<rect x="${(x + innerOffset).toFixed(2)}" y="${(y + innerOffset).toFixed(2)}" width="${innerSize.toFixed(2)}" height="${innerSize.toFixed(2)}" rx="${innerRadius}" fill="${fg}"/>`);
}

function escapeXml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
