/** Reference model for the calculator's authored-order adaptive scheduler. */
export function createAdaptiveSchedule({ cardCount, maxExposuresPerCard }) {
  if (!Number.isInteger(cardCount) || cardCount < 1 || cardCount > 12
      || !Number.isInteger(maxExposuresPerCard)
      || maxExposuresPerCard < 1 || maxExposuresPerCard > 4) {
    throw new Error('invalid adaptive scheduler policy');
  }
  return {
    ordinal: 0,
    current: null,
    cards: Array.from({ length: cardCount }, (_, authoredIndex) => ({
      authoredIndex, exposureCount: 0, rating: null, retired: false, due: authoredIndex + 1,
    })),
    maxExposuresPerCard,
  };
}

export function presentNext(schedule) {
  const active = schedule.cards.filter(({ retired }) => !retired);
  if (active.length === 0) return null;
  let nextOrdinal = schedule.ordinal + 1;
  let eligible = active.filter(({ due }) => due <= nextOrdinal);
  if (eligible.length === 0) {
    nextOrdinal = Math.min(...active.map(({ due }) => due));
    schedule.ordinal = nextOrdinal - 1;
    eligible = active.filter(({ due }) => due <= nextOrdinal);
  }
  const card = eligible.sort((left, right) => (
    left.due - right.due || left.authoredIndex - right.authoredIndex
  ))[0];
  schedule.ordinal += 1;
  card.exposureCount += 1;
  schedule.current = card.authoredIndex;
  return card.authoredIndex;
}

export function rateCurrent(schedule, rating) {
  if (!['again', 'hard', 'know'].includes(rating) || schedule.current === null) {
    throw new Error('invalid adaptive rating');
  }
  const card = schedule.cards[schedule.current];
  card.rating = rating;
  if (rating === 'know' || card.exposureCount === schedule.maxExposuresPerCard) {
    card.retired = true;
  } else {
    card.due = schedule.ordinal + (rating === 'again' ? 3 : 5);
  }
  schedule.current = null;
}
