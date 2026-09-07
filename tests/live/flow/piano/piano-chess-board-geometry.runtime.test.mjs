import { expect, test } from '@playwright/test';
import { compile } from 'sass';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../../', import.meta.url);
const css = [
  'frontend/src/modules/Piano/game-platform/host/PianoGameHost.scss',
  'frontend/src/modules/Piano/game-platform/families/addressed-board/InstrumentBoardStage.scss',
  'frontend/src/modules/Chess/ChessBoard.scss',
  'frontend/src/modules/Piano/PianoChessGame/PianoChessGame.scss',
].map(path => compile(fileURLToPath(new URL(path, root))).css).join('\n');

// Real game styles and the BoardGameFrame/InstrumentBoardStage DOM contract.
// No learner, MIDI, game session, or production API is needed to measure CSS.
for (const viewport of [{ width: 1280, height: 800 }, { width: 1920, height: 1200 }, { width: 800, height: 600 }]) {
  test(`chess board fits its allocated slot at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.setContent(`<style>
      * { box-sizing: border-box; } body { margin: 0; --pg-rail-w: 248px; }
      ${css}
    </style><div class="piano-game-host piano-chess">
      <section class="instrument-board-stage instrument-board-stage--single piano-chess__stage">
        <div class="instrument-board-stage__status">Your turn</div>
        <aside class="instrument-board-stage__rail instrument-board-stage__rail--left">Settings</aside>
        <main class="instrument-board-stage__boards">
          <div class="instrument-board-stage__primary"><div class="chess-board-frame">
            <div class="chess-board__rank-axis">8</div>
            <div class="chess-board">${'<div class="chess-board__square">♟</div>'.repeat(64)}</div>
            <div class="chess-board__file-axis">A B C D E F G H</div>
          </div></div>
        </main>
        <aside class="instrument-board-stage__rail instrument-board-stage__rail--right">Opponent</aside>
      </section>
      <div class="piano-game-host__instrument" style="height:140px"></div>
    </div>`);
    const geometry = await page.evaluate(() => {
      const rect = selector => {
        const { x, y, width, height, right, bottom } = document.querySelector(selector).getBoundingClientRect();
        return { x, y, width, height, right, bottom };
      };
      return { board: rect('.chess-board'), slot: rect('.instrument-board-stage__primary'),
        instrument: rect('.piano-game-host__instrument') };
    });
    expect(geometry.board.width).toBeGreaterThan(250);
    expect(geometry.board.height).toBeCloseTo(geometry.board.width, 1);
    expect(geometry.board.x).toBeGreaterThanOrEqual(geometry.slot.x);
    expect(geometry.board.right).toBeLessThanOrEqual(geometry.slot.right + 1);
    expect(geometry.board.y).toBeGreaterThanOrEqual(geometry.slot.y - 1);
    expect(geometry.board.bottom).toBeLessThanOrEqual(geometry.slot.bottom + 1);
    expect(geometry.board.bottom).toBeLessThanOrEqual(geometry.instrument.y);
  });
}
