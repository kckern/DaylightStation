export function nextSeat(seats, currentSeatId, { active = () => true } = {}) {
  if (!Array.isArray(seats) || seats.length === 0) return null;
  const current = Math.max(0, seats.findIndex((seat) => seat.id === currentSeatId));
  for (let offset = 1; offset <= seats.length; offset += 1) {
    const candidate = seats[(current + offset) % seats.length];
    if (active(candidate)) return candidate;
  }
  return null;
}
