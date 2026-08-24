import { cardIdenticonCells, GRID_SIZE } from './cardIdenticonModel.js';

export function CardIdenticon({ seed }) {
  const cells = cardIdenticonCells(seed);
  return (
    <svg
      className="battle-card__identicon"
      viewBox={`0 0 ${GRID_SIZE} ${GRID_SIZE}`}
      aria-hidden="true"
      data-card-identicon={seed}
    >
      {cells.flatMap((row, rowIndex) => row.map((visible, columnIndex) => (
        visible ? (
          <rect
            key={`${columnIndex}-${rowIndex}`}
            x={columnIndex + 0.08}
            y={rowIndex + 0.08}
            width="0.84"
            height="0.84"
            rx="0.16"
          />
        ) : null
      )))}
    </svg>
  );
}

export default CardIdenticon;
