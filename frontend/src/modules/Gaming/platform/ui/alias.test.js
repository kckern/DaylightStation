import { describe, expect, it } from 'vitest';
import GameButton from '@gaming-ui/GameButton.jsx';
import PartyStage from '@gaming-ui/PartyStage.jsx';

describe('@gaming-ui alias', () => {
  it('resolves the Party Games primitive root', () => {
    expect(GameButton).toBeTypeOf('function');
    expect(PartyStage).toBeTypeOf('function');
  });
});
