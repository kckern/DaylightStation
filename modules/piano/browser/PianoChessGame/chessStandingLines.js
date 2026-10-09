/**
 * What the result card says about where this game left the player.
 *
 * Three facts, each only when it is true and useful. The record against this
 * opponent, because beating someone six times is worth seeing. Why a win did
 * not count, because a child who won and did not move up deserves the rule
 * that decided it. And how far along the climb they are. A loss that did not
 * count is not explained, because being told a loss "didn't count" reads as
 * a consolation nobody asked for.
 */

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

const HELP_WORDS = Object.freeze({
  best_moves: (count) => plural(count, 'best-move request', 'best-move requests'),
  hints: (count) => plural(count, 'hint', 'hints'),
  takebacks: (count) => plural(count, 'takeback', 'takebacks'),
});

export function headToHeadLine(headToHead) {
  const name = headToHead?.opponent?.name;
  if (!name) return null;
  const parts = [
    plural(Number(headToHead.win) || 0, 'win', 'wins'),
    plural(Number(headToHead.loss) || 0, 'loss', 'losses'),
  ];
  const draws = Number(headToHead.draw) || 0;
  if (draws > 0) parts.push(plural(draws, 'draw', 'draws'));
  return `You vs ${name}: ${parts.join(', ')}`;
}

function notCountedLine(notCounted, nextName) {
  const toward = nextName ? ` toward ${nextName}` : '';
  if (notCounted.reason === 'other_level') return `Practice game. It doesn't count${toward}.`;
  const words = HELP_WORDS[notCounted.reason];
  if (!words) return null;
  return `This win didn't count${toward}: ${words(Number(notCounted.used) || 0)}, ${Number(notCounted.allowed) || 0} allowed.`;
}

export function standingLines({ result, ladder }) {
  if (!ladder || ladder.persisted === false) return [];
  const lines = [];
  const record = headToHeadLine(ladder.head_to_head);
  if (record) lines.push(record);
  // The banner already says a new opponent is unlocked, and the progress
  // numbers now describe a climb that has not started.
  if (ladder.promoted) return lines;
  const nextName = ladder.up_next?.name || null;
  if (result === 'win' && ladder.not_counted) {
    const line = notCountedLine(ladder.not_counted, nextName);
    if (line) lines.push(line);
  }
  const status = ladder.status;
  if (status && !status.at_top && nextName) lines.push(`${status.wins} of ${status.needed} wins toward ${nextName}`);
  return lines;
}

export default { standingLines, headToHeadLine };
