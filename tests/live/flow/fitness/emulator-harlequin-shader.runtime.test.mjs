/**
 * Harlequin dot-matrix shader — live proof that the Game Boys' picture shader
 * actually lands inside the core.
 *
 * `presentation.ejs_shader` names one of OUR presets (bundled with the
 * frontend, registered as EJS_shaders at boot). The settle barrier applies it
 * and reads it back from the core's filesystem. This test checks the read-back
 * the same way, plus the two things a unit test cannot see:
 *
 *   1. The PNG textures arrive byte-for-byte. EmulatorJS's own resource path
 *      would corrupt them (string write, UTF-8), so the engine writes them as
 *      raw bytes — if that regresses, `paper-bg.png` comes back a different size.
 *   2. The console stands its canvas grid down for a core shader, so the two
 *      grids never double up.
 *
 * Runs against a live stack with the real data tree (the manifests under
 * media/emulation carry the ejs_shader declarations). Per
 * reference_laptop_backend_blocked_by_dropbox_dataless, run it where the data
 * tree is local, not against a dataless laptop mount.
 */
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

const PAPER_BG_BYTES = 243109; // frontend/src/modules/Emulator/shaders/gameboy/paper-bg.png
const CASES = [
  { title: 'Super Mario Land', preset: 'gameboy-harlequin.glslp' },
  { title: 'Pokémon Yellow', preset: 'gameboy-harlequin-color.glslp' },
];

test.describe('Emulator Harlequin picture shader', () => {
  test.setTimeout(180000);

  test.beforeAll(async ({ request }) => {
    // A dead backend behind Vite's proxy yields plausible-looking pages and a
    // 500 here; fail loudly instead (see the dataless-mount memory).
    const res = await request.get(`${FRONTEND_URL}/api/v1/emulator/library`);
    expect(res.status(), 'emulator library must be served by a live backend').toBe(200);
  });

  for (const { title, preset } of CASES) {
    test(`${title} runs ${preset} inside the core with intact textures`, async ({ page }) => {
      // ?nokiosk bypasses the admin fingerprint gate so the arcade launches directly.
      await page.goto(`${FRONTEND_URL}/fitness/module/emulator?nokiosk`);
      const card = page.getByRole('button', { name: title });
      await expect(card).toBeVisible({ timeout: 45000 });
      await card.click();

      await page.waitForFunction(
        () => window.EJS_emulator && window.EJS_emulator.started === true,
        null,
        { timeout: 120000 },
      );

      // The console must have stood its own grid down for the core shader.
      const root = page.locator('.emulator-console');
      await expect(root).toHaveAttribute('data-picture-shader', preset);
      await expect(root).toHaveAttribute('data-shader', 'none');
      await expect(page.locator('.emulator-shader-grid')).toHaveCount(0);

      // The settle barrier applies the preset after `started`; poll the same
      // read-back it uses rather than sampling once.
      await page.waitForFunction(
        () => {
          try {
            const text = window.EJS_emulator.Module.FS.readFile('/shader/shader.glslp', { encoding: 'utf8' });
            return /^shaders = 5/m.test(text);
          } catch { return false; }
        },
        null,
        { timeout: 30000 },
      ).catch(() => {
        throw new Error(`${preset} never landed in the core filesystem — the settle barrier's picture-shader step did not take`);
      });

      const state = await page.evaluate(() => {
        const { FS } = window.EJS_emulator.Module;
        const size = (f) => { try { return FS.readFile(`/shader/${f}`).length; } catch { return null; } };
        return {
          preset: FS.readFile('/shader/shader.glslp', { encoding: 'utf8' }),
          paperBg: size('paper-bg.png'),
          palette: size('gbp-palette.png'),
          pass0: size('gb-pass0.glsl'),
        };
      });
      expect(state.preset).toContain('BACKGROUND = paper-bg.png');
      expect(state.paperBg, 'paper-bg.png must be written as raw bytes, not a UTF-8-mangled string').toBe(PAPER_BG_BYTES);
      expect(state.palette).toBe(98);
      expect(state.pass0).toBeGreaterThan(10000);
    });
  }
});
