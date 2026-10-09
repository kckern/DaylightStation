export function createGenerateCatalog({
  createContentExpression,
  listSource,
  generateQRCode,
  renderPdf,
  logger = console,
} = {}) {
  if (typeof createContentExpression !== 'function' || !listSource?.getList ||
      typeof generateQRCode !== 'function' || typeof renderPdf !== 'function') {
    throw new Error('createGenerateCatalog requires contentExpression, listSource, generateQRCode, and renderPdf');
  }
  return async function generateCatalog({ source, id, expression }) {
    const screen = expression.screen;
    const optionString = Object.entries(expression.options)
      .map(([key, value]) => value === true ? key : `${key}=${value}`)
      .join('+') || null;
    const list = await listSource.getList(source, id);
    const title = list.title;
    const items = list.items;
    if (items.length === 0) return { kind: 'empty' };

    const svgs = [];
    for (let index = 0; index < items.length; index += 2) {
      const batch = items.slice(index, index + 2);
      const results = await Promise.all(batch.map(async (item) => {
        try {
          const options = {};
          for (const option of optionString?.split('+') || []) {
            const [key, value] = option.split('=');
            options[key] = value || true;
          }
          const itemExpression = createContentExpression({
            screen,
            action: 'queue',
            contentId: item.id,
            options,
          });
          return await generateQRCode({ expression: itemExpression });
        } catch (err) {
          logger.warn?.('catalog.qr.failed', { itemId: item.id, error: err.message });
          return null;
        }
      }));
      svgs.push(...results);
    }
    const validSvgs = svgs.filter(Boolean);
    if (validSvgs.length === 0) return { kind: 'render_unavailable' };
    return { kind: 'generated', value: { title, pdf: await renderPdf({ title, svgs: validSvgs, logger }) } };
  };
}
