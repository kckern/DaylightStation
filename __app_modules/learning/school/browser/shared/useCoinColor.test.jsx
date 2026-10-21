import { describe, expect, it } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import { useCoinColor, COIN_TOKENS } from "./useCoinColor.js";

describe('useCoinColor', () => {
  it('knows gold, and falls back to the gold hex with no stylesheet', () => {
    expect(COIN_TOKENS.gold).toEqual(['--school-coin-gold', '#e2c15a']);
    const { result } = renderHook(() => useCoinColor('gold'));
    expect(result.current[0]).toBe('#e2c15a');
  });

  it('reads the token off the element its ref lands on', () => {
    let seen = null;
    function Probe() {
      const [color, ref] = useCoinColor('gold');
      seen = color;
      return <div ref={ref} style={{ '--school-coin-gold': '#123456' }} />;
    }
    render(<Probe />);
    expect(seen).toBe('#123456');
  });

  it('a token that is not a hex keeps the fallback', () => {
    let seen = null;
    function Probe() {
      const [color, ref] = useCoinColor('silver');
      seen = color;
      return <div ref={ref} style={{ '--school-coin-silver': 'var(--elsewhere)' }} />;
    }
    render(<Probe />);
    expect(seen).toBe('#c0c0c0');
  });
});
