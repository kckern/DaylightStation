import test from 'node:test';
import assert from 'node:assert/strict';
import { gamingPresentationIntent, gamingPresentationProjection } from './embedding.mjs';

test('projects authority-safe game state into Presentation V2', () => {
  const projection = gamingPresentationProjection({
    experienceId: 'card-battle', sessionId: 'game:1', revision: 4,
    scene: { id: 'battle-arena', kind: 'fixed-grid-scene' }, model: { actor_state: 'attack' },
  });
  assert.equal(projection.schema, 'gaming-presentation/v1');
  assert.deepEqual(projection.model, { actor_state: 'attack' });
});

test('normalizes renderer input into semantic intents', () => {
  assert.deepEqual(gamingPresentationIntent('action.primary', { source: 'gamepad', timestamp: 12 }), {
    schema: 'gaming-presentation-intent/v1', action: 'action.primary', phase: 'press', value: 1, source: 'gamepad', timestamp: 12,
  });
  assert.throws(() => gamingPresentationIntent('session.overwrite'), /unknown presentation action/);
});
