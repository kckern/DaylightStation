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
