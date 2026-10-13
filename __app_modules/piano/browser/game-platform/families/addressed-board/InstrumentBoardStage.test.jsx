import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import InstrumentBoardStage from './InstrumentBoardStage.jsx';

describe('InstrumentBoardStage topRail', () => {
  it('renders the topRail above the primary board', () => {
    const { container } = render(
      <InstrumentBoardStage
        topRail={<div data-testid="rail">rail</div>}
        primary={<div data-testid="board">board</div>}
      />,
    );
    const boards = container.querySelector('.instrument-board-stage__boards');
    const rail = boards.querySelector('[data-testid="rail"]');
    const board = boards.querySelector('[data-testid="board"]');
    expect(rail).toBeTruthy();
    expect(board).toBeTruthy();
    // DOM order inside the boards container is render order — topRail is
    // written before primary, so a CSS-free assertion on position works too.
    expect(rail.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('omits the top-rail wrapper entirely when no topRail is given', () => {
    const { container } = render(<InstrumentBoardStage primary={<div>board</div>} />);
    expect(container.querySelector('.instrument-board-stage__top-rail')).toBeFalsy();
  });
});

describe('InstrumentBoardStage status', () => {
  it('renders status when provided', () => {
    const { container } = render(
      <InstrumentBoardStage primary={<div>board</div>} status={<div data-testid="status">Your turn</div>} />,
    );
    const status = container.querySelector('.instrument-board-stage__status');
    expect(status).toBeTruthy();
    expect(status.querySelector('[data-testid="status"]')).toBeTruthy();
  });

  it('renders nothing for status when none is given', () => {
    const { container } = render(<InstrumentBoardStage primary={<div>board</div>} />);
    expect(container.querySelector('.instrument-board-stage__status')).toBeFalsy();
  });

  it('places status in the rail structure, not as a bottom-row footer', () => {
    const { container } = render(
      <InstrumentBoardStage primary={<div>board</div>} status={<div>Your turn</div>} />,
    );
    // No <footer> at all: the old bottom-row element is gone outright, not
    // just moved. The stage is a single grid; `status` is one of its own
    // named grid areas (see InstrumentBoardStage.scss) rather than a nested
    // child of `.instrument-board-stage__rail`, which is what lets the
    // narrow-width media query reflow this SAME element back to a full-width
    // row without any JS branch or a second, duplicated status node.
    expect(container.querySelector('footer')).toBeFalsy();
    const status = container.querySelector('.instrument-board-stage__status');
    const section = container.querySelector('.instrument-board-stage');
    expect(status.parentElement).toBe(section);
    expect(status.closest('.instrument-board-stage__rail')).toBeFalsy();
    expect(status.closest('.instrument-board-stage__boards')).toBeFalsy();
  });

  it('keeps the left rail its own sibling, so wide layouts can stack status above it purely in CSS', () => {
    const { container } = render(
      <InstrumentBoardStage
        primary={<div>board</div>}
        leftRail={<div data-testid="left-content">Opponent</div>}
        status={<div>Your turn</div>}
      />,
    );
    const status = container.querySelector('.instrument-board-stage__status');
    const leftRail = container.querySelector('.instrument-board-stage__rail--left');
    expect(leftRail.querySelector('[data-testid="left-content"]')).toBeTruthy();
    // The rail's own content lives only inside the rail aside; status is a
    // distinct grid item, so removing/hiding one never touches the other.
    expect(leftRail.contains(status)).toBe(false);
  });
});
