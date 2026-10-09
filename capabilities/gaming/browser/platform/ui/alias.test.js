import { describe, expect, it } from 'vitest';
import GameButton from "./GameButton.jsx";
import PartyStage from "./PartyStage.jsx";

describe('@gaming-ui alias', () => {
  it('resolves the Party Games primitive root', () => {
    expect(GameButton).toBeTypeOf('function');
    expect(PartyStage).toBeTypeOf('function');
  });
});
