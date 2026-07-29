// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createSheetService } from './SheetService.mjs';

/**
 * Fixtures are hand-built on purpose. The real nutrition providers live in
 * `5_composition/` and this service must never reach for them: `source` and
 * `cell.kind` are injected registries, so the service is testable with two
 * literals and a stub. If this file ever needs `#composition/…`, the seam broke.
 */
const baseConfig = () => ({
  defaults: { page: { size: 'letter', margin_pt: 36 }, cell: { kind: 'qr', gap_pt: 8 } },
  sheets: {
    fridge: {
      title: 'Kitchen scale',
      blocks: [
        { title: 'Density', source: 'demo.two', grid: { cols: 3, rows: 3 }, cell: { kind: 'qr' } },
      ],
    },
  },
});

const twoCodes = () => ([{ code: 'a', label: 'A' }, { code: 'b', label: 'B' }]);
const providers = { 'demo.two': twoCodes };
const cellKinds = { qr: () => '<svg/>', label: () => '<svg/>' };

const svcWith = (config, overrides = {}) => createSheetService({
  getConfig: () => config,
  providers,
  cellKinds,
  ...overrides,
});

describe('SheetService', () => {
  describe('the happy path', () => {
    it('builds a model with resolved items, placements and a fingerprint', async () => {
      const model = await svcWith(baseConfig()).build('fridge', {});

      expect(model.sheetId).toBe('fridge');
      expect(model.title).toBe('Kitchen scale');
      expect(model.page).toEqual({ widthPt: 612, heightPt: 792, marginPt: 36 });
      expect(model.blocks).toHaveLength(1);
      expect(model.blocks[0].items).toEqual(twoCodes());
      expect(model.blocks[0].kind).toBe('qr');
      expect(model.placements.cells).toHaveLength(2);
      expect(model.fingerprint).toMatch(/^[0-9a-f]{6}$/);
    });

    it('falls back to the sheet id when the sheet declares no title', async () => {
      const config = baseConfig();
      delete config.sheets.fridge.title;
      const model = await svcWith(config).build('fridge', {});
      expect(model.title).toBe('fridge');
    });

    it('awaits async providers', async () => {
      const config = baseConfig();
      const svc = createSheetService({
        getConfig: () => config,
        providers: { 'demo.two': async () => twoCodes() },
        cellKinds,
      });
      const model = await svc.build('fridge', {});
      expect(model.blocks[0].items).toHaveLength(2);
    });

    it('forwards params to the provider', async () => {
      const spy = vi.fn(() => twoCodes());
      const svc = createSheetService({
        getConfig: () => baseConfig(),
        providers: { 'demo.two': spy },
        cellKinds,
      });
      await svc.build('fridge', { household: 'h1', limit: 4 });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toEqual({ household: 'h1', limit: 4 });
      expect(spy.mock.calls[0][1]).toMatchObject({ sheetId: 'fridge' });
    });
  });

  describe('structural failures reject and emit NO model', () => {
    // The router maps 404 vs 500 by matching this regex, so the wording is a
    // contract, not prose. If a message stops matching, the route starts 500ing
    // on what is really a bad sheet id.
    const ROUTER_REGEX = /unknown (sheet|source|cell kind|page size)/i;

    it('refuses an unknown sheet id', async () => {
      const err = await svcWith(baseConfig()).build('nope', {}).catch((e) => e);
      expect(err.message).toMatch(/unknown sheet/i);
      expect(err.message).toMatch(ROUTER_REGEX);
    });

    it('refuses an unknown source', async () => {
      const config = baseConfig();
      config.sheets.fridge.blocks[0].source = 'missing.provider';
      const err = await svcWith(config).build('fridge', {}).catch((e) => e);
      expect(err.message).toMatch(/unknown source/i);
      expect(err.message).toMatch(ROUTER_REGEX);
    });

    it('refuses an unknown cell kind', async () => {
      const config = baseConfig();
      config.sheets.fridge.blocks[0].cell = { kind: 'runes' };
      const err = await svcWith(config).build('fridge', {}).catch((e) => e);
      expect(err.message).toMatch(/unknown cell kind/i);
      expect(err.message).toMatch(ROUTER_REGEX);
    });

    it('refuses an unknown page size', async () => {
      const config = baseConfig();
      config.sheets.fridge.page = { size: 'tabloid' };
      const err = await svcWith(config).build('fridge', {}).catch((e) => e);
      expect(err.message).toMatch(/unknown page size/i);
      expect(err.message).toMatch(ROUTER_REGEX);
    });

    it('lets a provider that throws take the whole sheet down', async () => {
      const config = baseConfig();
      config.sheets.fridge.blocks.push({
        title: 'Second', source: 'demo.boom', grid: { cols: 3, rows: 3 },
      });
      const svc = createSheetService({
        getConfig: () => config,
        providers: { ...providers, 'demo.boom': () => { throw new Error('encoder rejected "  "'); } },
        cellKinds,
      });

      // Not merely "it throws": the FIRST block resolved fine, so a lenient
      // implementation could have returned a one-block sheet. A sheet missing a
      // whole bank of codes is discovered at the fridge, not at the printer.
      await expect(svc.build('fridge', {})).rejects.toThrow(/encoder rejected/);
    });

    it('rejects before any block resolves when the sheet id is bad', async () => {
      const spy = vi.fn(() => twoCodes());
      const svc = createSheetService({
        getConfig: () => baseConfig(),
        providers: { 'demo.two': spy },
        cellKinds,
      });
      await expect(svc.build('nope', {})).rejects.toThrow();
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('defaults', () => {
    it('uses defaults.cell.kind when a block declares no cell', async () => {
      const config = baseConfig();
      delete config.sheets.fridge.blocks[0].cell;
      const model = await svcWith(config).build('fridge', {});
      expect(model.blocks[0].kind).toBe('qr');
      expect(model.blocks[0].gapPt).toBe(8);
    });

    it('uses defaults.page when the sheet declares no page', async () => {
      const config = baseConfig();
      config.defaults.page = { size: 'a4', margin_pt: 20 };
      const model = await svcWith(config).build('fridge', {});
      expect(model.page).toEqual({ widthPt: 595, heightPt: 842, marginPt: 20 });
    });

    it('lets a sheet override the default page size and margin', async () => {
      const config = baseConfig();
      config.sheets.fridge.page = { size: 'a4', margin_pt: 12 };
      const model = await svcWith(config).build('fridge', {});
      expect(model.page).toEqual({ widthPt: 595, heightPt: 842, marginPt: 12 });
    });

    it('lets a block override the default gap', async () => {
      const config = baseConfig();
      config.sheets.fridge.blocks[0].cell = { kind: 'qr', gap_pt: 24 };
      const model = await svcWith(config).build('fridge', {});
      expect(model.blocks[0].gapPt).toBe(24);
    });
  });

  describe('cell shape reaches the layout', () => {
    it('passes the block aspect through so cells are not letterboxed', async () => {
      const square = baseConfig();
      const framed = baseConfig();
      framed.sheets.fridge.blocks[0].cell = { kind: 'qr', aspect: 0.5 };

      const a = await svcWith(square).build('fridge', {});
      const b = await svcWith(framed).build('fridge', {});

      expect(a.blocks[0].aspect).toBeUndefined();
      expect(b.blocks[0].aspect).toBe(0.5);
      // aspect is width/height, so halving it doubles the cell height.
      expect(b.placements.cells[0].h).toBeCloseTo(a.placements.cells[0].h * 2, 5);
      expect(b.placements.cells[0].w).toBeCloseTo(a.placements.cells[0].w, 5);
    });

    it('normalizes snake_case cell config into the camelCase opts renderers read', async () => {
      const config = baseConfig();
      config.sheets.fridge.blocks[0].cell = { kind: 'qr', size_pt: 108, aspect: 0.73 };
      const model = await svcWith(config).build('fridge', {});
      // `cellRenderers.qr` reads opts.sizePt; YAML spells it size_pt.
      expect(model.blocks[0].cellOpts.sizePt).toBe(108);
      expect(model.blocks[0].cellOpts.aspect).toBe(0.73);
    });
  });

  describe('cosmetic defects log and continue', () => {
    it('logs an underfull block at debug but still builds it', async () => {
      const logger = { debug: vi.fn(), warn: vi.fn() };
      // 2 items in a 3x3 grid.
      const model = await svcWith(baseConfig(), { logger }).build('fridge', {});

      expect(model.blocks[0].items).toHaveLength(2);
      expect(model.placements.cells).toHaveLength(2);
      expect(logger.debug).toHaveBeenCalledWith(
        'sheet.block.underfull',
        expect.objectContaining({ sheet: 'fridge', capacity: 9, items: 2 }),
      );
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('the fingerprint hashes codes, not labels', () => {
    const fpFor = async (items, config = baseConfig()) => {
      const svc = createSheetService({
        getConfig: () => config, providers: { 'demo.two': () => items }, cellKinds,
      });
      return (await svc.build('fridge', {})).fingerprint;
    };

    it('is stable across repeated builds', async () => {
      const svc = svcWith(baseConfig());
      expect((await svc.build('fridge', {})).fingerprint)
        .toBe((await svc.build('fridge', {})).fingerprint);
    });

    it('changes when a code changes', async () => {
      const a = await fpFor([{ code: 'a', label: 'A' }, { code: 'b', label: 'B' }]);
      const b = await fpFor([{ code: 'a', label: 'A' }, { code: 'z', label: 'B' }]);
      expect(b).not.toBe(a);
    });

    it('does NOT change when only a label changes', async () => {
      // A relabelled button still scans the same, so a laminated sheet whose
      // fingerprint matches is still correct. That is the whole point.
      const a = await fpFor([{ code: 'a', label: 'A' }, { code: 'b', label: 'B' }]);
      const b = await fpFor([
        { code: 'a', label: 'Totally different', sublabel: 'and a new hint' },
        { code: 'b', label: 'Also renamed' },
      ]);
      expect(b).toBe(a);
    });

    it('survives codeless items (foods have no grammar yet)', async () => {
      const fp = await fpFor([{ label: 'Rice' }, { label: 'Beans' }]);
      expect(fp).toMatch(/^[0-9a-f]{6}$/);
    });

    it('does not let a codeless item collide with the literal string "undefined"', async () => {
      // The bug this pins: hashing `item.code` straight would stringify a missing
      // code to "undefined", making these two sheets indistinguishable.
      const codeless = await fpFor([{ label: 'Rice' }]);
      const literal = await fpFor([{ code: 'undefined', label: 'Rice' }]);
      expect(codeless).not.toBe(literal);
    });

    it('still notices a codeless item being added or removed', async () => {
      const one = await fpFor([{ code: 'a', label: 'A' }, { label: 'Rice' }]);
      const two = await fpFor([{ code: 'a', label: 'A' }, { label: 'Rice' }, { label: 'Beans' }]);
      expect(two).not.toBe(one);
    });
  });
});
