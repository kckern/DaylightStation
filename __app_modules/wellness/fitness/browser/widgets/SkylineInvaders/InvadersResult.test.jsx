import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import InvadersResult from './InvadersResult.jsx';

const level = (pass) => ({ id: 'invaders-test', name: 'Test Wave', duration_s: 30, pass });
const record = (run) => ({ run: { status: 'completed', kills: 0, score: 0, best_combo: 0, base_hp: 100, stars: 1, reward_rings: 0, ...run } });
const show = (run, pass = { kills: 4, base_hp_min: 40 }) => render(
  <InvadersResult record={record(run)} saveStatus="saved" level={level(pass)} active={false} />,
);
const row = (id) => {
  const node = screen.getByTestId(`invaders-result-${id}`);
  // Label, number, and what was asked for (in small print beside the label).
  const label = node.querySelector('dt').firstChild.textContent;
  const note = node.querySelector('dt small')?.textContent;
  return { met: node.getAttribute('data-met'), parts: [label, node.querySelector('dd').textContent, ...(note ? [note] : [])] };
};

describe('InvadersResult — the numbers against what the level asked for', () => {
  it('shows a round far over its target as the count, with the target in small print', () => {
    show({ kills: 25, base_hp: 80 });
    expect(row('kills')).toEqual({ met: 'true', parts: ['Shot down', '25', 'needed 4'] });
    expect(screen.getByTestId('skyline-invaders-result').textContent).not.toMatch(/25 of 4/);
  });

  it('shows a round exactly on its target as met', () => {
    show({ kills: 4 });
    expect(row('kills')).toEqual({ met: 'true', parts: ['Shot down', '4', 'needed 4'] });
  });

  it('marks a round short of its target', () => {
    show({ status: 'failed', kills: 3, stars: 0 });
    expect(row('kills')).toEqual({ met: 'false', parts: ['Shot down', '3', 'needed 4'] });
  });

  it('shows no kills as 0 against the target', () => {
    show({ status: 'failed', kills: 0, stars: 0 });
    expect(row('kills')).toEqual({ met: 'false', parts: ['Shot down', '0', 'needed 4'] });
  });

  it('says which of the two fell short: enough kills, too little skyline left', () => {
    show({ status: 'failed', kills: 25, base_hp: 30, stars: 0 });
    expect(row('kills').met).toBe('true');
    expect(row('skyline')).toEqual({ met: 'false', parts: ['Skyline', '30%', 'needed 40%'] });
  });

  it('shows the skyline floor as met when it held', () => {
    show({ kills: 25, base_hp: 40 });
    expect(row('skyline')).toEqual({ met: 'true', parts: ['Skyline', '40%', 'needed 40%'] });
  });

  it('leaves the skyline unmarked on a level with no floor', () => {
    show({ kills: 25, base_hp: 10 }, { kills: 4 });
    expect(row('skyline')).toEqual({ met: null, parts: ['Skyline', '10%'] });
    expect(row('score').met).toBeNull();
  });
});
