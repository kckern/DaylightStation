import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { GameRail, GameSlot, GameButton, GameStatusBar, GameToggle, GameChoice, LadderBadge } from './index.js';

describe('GameSlot', () => {
  it('reserves its height from `reserve`, so the rail cannot reflow as input lands', () => {
    // The signature rule: a slot holds its size whether or not it has anything
    // to say. Without this the board itself moves while the player is looking
    // at it.
    const { container } = render(<GameSlot reserve="9.75rem">said something</GameSlot>);
    expect(container.querySelector('.pg-slot').style.getPropertyValue('--pg-slot-reserve')).toBe('9.75rem');
  });

  it('reserves nothing when not asked to, rather than inventing a height', () => {
    const { container } = render(<GameSlot>content</GameSlot>);
    expect(container.querySelector('.pg-slot').getAttribute('style')).toBeNull();
  });

  it('renders the label as a heading so a rail is navigable, not a wall of divs', () => {
    const { container } = render(<GameSlot label="In hand">empty</GameSlot>);
    const heading = container.querySelector('.pg-slot__label');
    expect(heading.tagName).toBe('H2');
    expect(heading.textContent).toBe('In hand');
  });

  it('omits the label element entirely when unlabelled', () => {
    const { container } = render(<GameSlot>content</GameSlot>);
    expect(container.querySelector('.pg-slot__label')).toBeNull();
  });

  it('carries one variant or several', () => {
    const { container: one } = render(<GameSlot variant="active">x</GameSlot>);
    expect(one.querySelector('.pg-slot--active')).toBeTruthy();

    const { container: many } = render(<GameSlot variant={['well', 'active']}>x</GameSlot>);
    expect(many.querySelector('.pg-slot--well.pg-slot--active')).toBeTruthy();
  });
});

describe('GameButton', () => {
  it('defaults to type=button — a game control never submits anything', () => {
    const { container } = render(<GameButton>Play again</GameButton>);
    expect(container.querySelector('button').type).toBe('button');
  });

  it('carries its variant and stays a .pg-btn, so the touch floor always applies', () => {
    const { container } = render(<GameButton variant="primary">Play again</GameButton>);
    expect(container.querySelector('.pg-btn.pg-btn--primary')).toBeTruthy();
  });

  it('forwards handlers and disabled state', () => {
    const onClick = vi.fn();
    const { container } = render(<GameButton onClick={onClick} disabled>Play again</GameButton>);
    const button = container.querySelector('button');
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('GameStatusBar', () => {
  it('announces — the turn, the refusal and the result all speak through it', () => {
    const { container } = render(<GameStatusBar>Your move</GameStatusBar>);
    expect(container.querySelector('[role="status"]').textContent).toContain('Your move');
  });

  it('keeps the qualifier out of the sentence', () => {
    const { container } = render(<GameStatusBar aside="local practice">Draw game</GameStatusBar>);
    expect(container.querySelector('.pg-status__aside').textContent).toContain('local practice');
    expect(container.querySelector('.pg-status__aside').textContent).not.toContain('Draw game');
  });

  it('renders no aside element when there is no qualifier', () => {
    const { container } = render(<GameStatusBar>Draw game</GameStatusBar>);
    expect(container.querySelector('.pg-status__aside')).toBeNull();
  });
});

describe('GameToggle', () => {
  it('is a switch, not a checkbox — the OS widget is unusable on the kiosk', () => {
    const { container } = render(<GameToggle label="Re-deal" checked={false} onChange={() => {}} />);
    const control = container.querySelector('[role="switch"]');
    expect(control.tagName).toBe('BUTTON');
    expect(control.getAttribute('aria-checked')).toBe('false');
    expect(container.querySelector('input')).toBeNull();
  });

  it('reports the value it would become, not the one it has', () => {
    const onChange = vi.fn();
    const { container } = render(<GameToggle label="Re-deal" checked onChange={onChange} />);
    fireEvent.click(container.querySelector('[role="switch"]'));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe('GameChoice', () => {
  const options = [{ value: 'notes', label: 'Single notes' }, { value: 'chords', label: 'Major chords' }];

  it('shows every option at once rather than hiding them behind a picker', () => {
    const { container } = render(<GameChoice label="Input" value="notes" options={options} onChange={() => {}} />);
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(2);
    expect(container.querySelector('select')).toBeNull();
  });

  it('marks exactly the chosen option', () => {
    const { container } = render(<GameChoice value="chords" options={options} onChange={() => {}} />);
    const radios = [...container.querySelectorAll('[role="radio"]')];
    expect(radios.map((node) => node.getAttribute('aria-checked'))).toEqual(['false', 'true']);
  });

  it('reports the chosen value', () => {
    const onChange = vi.fn();
    const { container } = render(<GameChoice value="notes" options={options} onChange={onChange} />);
    fireEvent.click(container.querySelectorAll('[role="radio"]')[1]);
    expect(onChange).toHaveBeenCalledWith('chords');
  });
});

describe('LadderBadge', () => {
  it('draws one rung per level and lights exactly the one you are on', () => {
    const { container } = render(<LadderBadge name="Pebble" level={3} levels={7} />);
    const rungs = [...container.querySelectorAll('.pg-ladder__rung')];
    expect(rungs).toHaveLength(7);
    expect(rungs.filter((node) => node.className.includes('--here'))).toHaveLength(1);
    expect(rungs.filter((node) => node.className.includes('--climbed'))).toHaveLength(2);
  });

  it('states the rung in words for anyone not reading shapes', () => {
    const { container } = render(<LadderBadge name="Pebble" level={3} levels={7} />);
    expect(container.querySelector('.pg-ladder__rungs').getAttribute('aria-label')).toBe('Level 3 of 7');
  });

  it('draws one pip per win needed and fills those already won', () => {
    const { container } = render(<LadderBadge name="Button" wins={2} needed={3} />);
    const pips = [...container.querySelectorAll('.pg-ladder__pip')];
    expect(pips).toHaveLength(3);
    expect(pips.filter((node) => node.className.includes('--won'))).toHaveLength(2);
  });

  it('draws no ladder and no tally when the ladder has not resolved yet', () => {
    const { container } = render(<LadderBadge name="Opponent" />);
    expect(container.querySelectorAll('.pg-ladder__rung')).toHaveLength(0);
    expect(container.querySelectorAll('.pg-ladder__pip')).toHaveLength(0);
    expect(container.textContent).toContain('Opponent');
  });

  it('never overfills the tally when a stale win count outruns what is needed', () => {
    const { container } = render(<LadderBadge name="Button" wins={9} needed={3} />);
    expect(container.querySelectorAll('.pg-ladder__pip--won')).toHaveLength(3);
  });

  it('takes a portrait without owning what one is', () => {
    const { container } = render(<LadderBadge name="Pebble" portrait={<img alt="" src="x.png" />} />);
    expect(container.querySelector('.pg-ladder img')).toBeTruthy();
  });
});

describe('GameRail', () => {
  it('pins the foot below the slots rather than letting it float mid-rail', () => {
    const { container } = render(
      <GameRail foot={<GameButton>Settings</GameButton>}><GameSlot>a</GameSlot></GameRail>,
    );
    const rail = container.querySelector('.pg-rail');
    expect(rail.lastElementChild.className).toBe('pg-rail__foot');
  });

  it('renders no foot element when a game has no rail actions', () => {
    const { container } = render(<GameRail><GameSlot>a</GameSlot></GameRail>);
    expect(container.querySelector('.pg-rail__foot')).toBeNull();
  });
});
