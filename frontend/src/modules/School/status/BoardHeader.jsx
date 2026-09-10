/**
 * BoardHeader — what the day board is headed with, and the one place on the
 * locked panel that takes a tap.
 *
 * It replaced the word "Today". A wall panel in a hallway is the thing people
 * glance at on the way past, and "Today" told them nothing they did not
 * already know; the date and the time are the two facts a glance is actually
 * after.
 *
 * IT LIVES BESIDE THE BOARD, NOT INSIDE IT. `AgendaStatusBoard` renders
 * nothing at all on a settled-empty day, and a header that vanishes with it
 * would take the book door down too — on exactly the quiet day a child is most
 * likely to be logging a book rather than doing assigned work. Keeping it a
 * sibling also leaves the board's "deliberately NON-INTERACTIVE" contract
 * intact: the tappable thing is the header's, never a row's.
 *
 * THE MINUTE TICK IS NOT MOTION. The board's own header forbids anything that
 * moves, and that stands — this changes a value once a minute, with no
 * animation, no transition and no layout shift (the time sits in its own
 * block). It is aligned to the minute boundary rather than ticking every 60s
 * from mount, so the displayed minute changes when the minute does.
 */
import { useEffect, useState } from 'react';
import { LanguageDisc } from '../ime/HangulTypingProvider.jsx';

const TIME = { hour: 'numeric', minute: '2-digit' };
const DATE = { weekday: 'long', month: 'long', day: 'numeric' };

export default function BoardHeader({ children, now = null }) {
  const [tick, setTick] = useState(() => now ?? new Date());

  useEffect(() => {
    if (now) return undefined;
    let interval = null;
    // Land on the boundary first, then keep to it.
    const timeout = setTimeout(() => {
      setTick(new Date());
      interval = setInterval(() => setTick(new Date()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => { clearTimeout(timeout); if (interval) clearInterval(interval); };
  }, [now]);

  const when = now ?? tick;
  return (
    <header className="school-board-header">
      <div className="school-board-header__when">
        <h2 className="school-board-header__time">
          {when.toLocaleTimeString(undefined, TIME)}
          {/* The typing language's status register: a flag disc beside the
              clock, where a glance already lands. The labelled badge appears
              only while a field is being typed into. */}
          <LanguageDisc className="school-board-header__lang" />
        </h2>
        <p className="school-board-header__date">{when.toLocaleDateString(undefined, DATE)}</p>
      </div>
      {children}
    </header>
  );
}
