import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import CycleGameHome from './CycleGameHome.jsx';

const bikes = [
  { id: 'cycle_ace', name: 'CycleAce', rider: 'milo' },
  { id: 'tricycle', name: 'Tricycle', rider: null }
];
const people = [
  { id: 'milo', name: 'Milo', avatarSrc: '/api/v1/static/img/users/milo', heartRate: 130, zoneId: 'hot', zoneColor: 'orange', hasHR: true },
  { id: 'felix', name: 'Felix', avatarSrc: '/api/v1/static/img/users/felix', heartRate: null, zoneId: null, zoneColor: null, hasHR: false }
];

describe('CycleGameHome', () => {
  it('renders the distance/time race-type dichotomy (no custom tile)', () => {
    const { getByTestId, queryByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} />
    );
    expect(getByTestId('course-distance')).toBeTruthy();
    expect(getByTestId('course-time')).toBeTruthy();
    expect(queryByTestId('course-custom')).toBeNull();
  });

  it('fires onSelectRaceType when a type tile is chosen', () => {
    const onSelectRaceType = vi.fn();
    const { getByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} onSelectRaceType={onSelectRaceType} />
    );
    fireEvent.click(getByTestId('course-distance'));
    expect(onSelectRaceType).toHaveBeenCalledWith('distance');
    fireEvent.click(getByTestId('course-time'));
    expect(onSelectRaceType).toHaveBeenCalledWith('time');
  });

  it('reveals a value step only after a type is chosen', () => {
    const { queryByTestId, rerender } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} raceType={null} />
    );
    expect(queryByTestId('cgh-value')).toBeNull();
    rerender(<CycleGameHome bikes={bikes} people={people} records={[]} raceType="distance" />);
    expect(queryByTestId('cgh-value')).toBeTruthy();
  });

  it('renders named distance tiers (Flash…Long) with the value as a sub-label', () => {
    const { getByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} raceType="distance" />
    );
    ['flash', 'sprint', 'short', 'medium', 'long'].forEach((key) => {
      expect(getByTestId(`tier-${key}`)).toBeTruthy();
    });
    expect(getByTestId('tier-flash').textContent).toContain('Flash');
    expect(getByTestId('tier-flash').textContent).toContain('100 m');
    expect(getByTestId('tier-long').textContent).toContain('5 km');
  });

  it('renders named time tiers with minute sub-labels', () => {
    const { getByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} raceType="time" />
    );
    expect(getByTestId('tier-flash').textContent).toContain('1 min');
    expect(getByTestId('tier-medium').textContent).toContain('5 min');
    expect(getByTestId('tier-long').textContent).toContain('10 min');
  });

  it('clicking a named tier fires onSetRaceValue with its numeric value', () => {
    const onSetRaceValue = vi.fn();
    const { getByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} raceType="distance" onSetRaceValue={onSetRaceValue} />
    );
    fireEvent.click(getByTestId('tier-sprint'));
    expect(onSetRaceValue).toHaveBeenCalledWith(300);
    fireEvent.click(getByTestId('tier-long'));
    expect(onSetRaceValue).toHaveBeenCalledWith(5000);
  });

  it('pre-selects the Medium tier when no value is supplied', () => {
    const { getByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} raceType="distance" />
    );
    expect(getByTestId('tier-medium').className).toContain('is-selected');
    expect(getByTestId('tier-flash').className).not.toContain('is-selected');
  });

  it('renders a starting grid slot per bike, equipment hero + assigned rider avatar', () => {
    const { getByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} />
    );
    expect(getByTestId('bike-cycle_ace')).toBeTruthy();
    expect(getByTestId('bike-tricycle')).toBeTruthy();
    // a filled slot keeps the equipment hero AND shows the rider's avatar
    // (no name label on the slot — names live in the picker)
    const filled = getByTestId('bike-cycle_ace');
    expect(filled.querySelector('.cgh-slot__device')).toBeTruthy();
    expect(filled.querySelector('.cgh-slot__rider-avatar')).toBeTruthy();
    expect(filled.querySelector('.cgh-slot__rider-name')).toBeNull();
    // an empty slot has no rider avatar, still has the equipment hero
    const empty = getByTestId('bike-tricycle');
    expect(empty.querySelector('.cgh-slot__rider-avatar')).toBeNull();
    expect(empty.querySelector('.cgh-slot__device')).toBeTruthy();
  });

  it('opens the rider picker and assigns a rider on-screen', () => {
    const onAssign = vi.fn();
    const { getByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} onAssign={onAssign} />
    );
    // open picker for the empty tricycle slot
    fireEvent.click(getByTestId('bike-tricycle').querySelector('.cgh-slot__main'));
    expect(getByTestId('rider-picker')).toBeTruthy();
    fireEvent.click(getByTestId('assign-felix'));
    expect(onAssign).toHaveBeenCalledWith('tricycle', 'felix');
  });

  it('opens the rider picker when the add-rider hint (anywhere in the slot) is clicked', () => {
    const { getByTestId, queryByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} />
    );
    expect(queryByTestId('rider-picker')).toBeNull();
    // Click the "+ Add rider" hint specifically — the whole slot must be the target.
    const addHint = getByTestId('bike-tricycle').querySelector('.cgh-slot__add');
    expect(addHint).toBeTruthy();
    fireEvent.click(addHint);
    expect(getByTestId('rider-picker')).toBeTruthy();
  });

  it('clears an assigned rider via the picker Clear tile', () => {
    const onUnassign = vi.fn();
    const { getByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} onUnassign={onUnassign} />
    );
    // clicking a filled slot reopens the picker, which offers Clear
    fireEvent.click(getByTestId('bike-cycle_ace').querySelector('.cgh-slot__main'));
    expect(getByTestId('rider-picker')).toBeTruthy();
    fireEvent.click(getByTestId('rider-clear'));
    expect(onUnassign).toHaveBeenCalledWith('cycle_ace');
  });

  it('separates guests behind a tab; household shows on the main tab', () => {
    const mixed = [
      { id: 'milo', name: 'Milo', hasHR: false, isGuest: false },
      { id: 'lila', name: 'Lila', hasHR: false, isGuest: true }
    ];
    const { getByTestId, queryByTestId, getByRole } = render(
      <CycleGameHome bikes={bikes} people={mixed} records={[]} />
    );
    fireEvent.click(getByTestId('bike-tricycle').querySelector('.cgh-slot__main'));
    // household tab is default: Milo present, Lila (guest) hidden
    expect(getByTestId('assign-milo')).toBeTruthy();
    expect(queryByTestId('assign-lila')).toBeNull();
    // switch to Guests tab → Lila appears
    fireEvent.click(getByRole('tab', { name: 'Guests' }));
    expect(getByTestId('assign-lila')).toBeTruthy();
  });

  it('ghost picker: first tap focuses a card, second tap opens the roster submenu', () => {
    const onSelectGhost = vi.fn();
    // Multi-rider race: the second tap opens the roster (single-rider races skip it —
    // covered separately below).
    const candidates = [{
      raceId: '20260602150118', day: '2026-06-02', timeOfDay: '3:01 pm',
      participants: [
        { id: 'milo', displayName: 'Milo', avatarSrc: '/x', isGhost: false },
        { id: 'felix', displayName: 'Felix', avatarSrc: '/f', isGhost: false }
      ],
      winnerName: 'Milo', goalKind: 'distance', goalLabel: '3 km', scoreKind: 'time', scoreLabel: '4:12'
    }];
    const { getByTestId, queryByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} ghostCandidates={candidates} onSelectGhost={onSelectGhost} />
    );
    fireEvent.click(getByTestId('course-ghost')); // open the ghost picker
    const card = getByTestId('ghost-20260602150118');
    fireEvent.click(card); // first tap → focus only (tap-to-scroll pattern)
    expect(onSelectGhost).not.toHaveBeenCalled();
    expect(queryByTestId('ghost-roster')).toBeNull(); // roster not yet open
    fireEvent.click(card); // second tap → opens roster submenu, does NOT yet commit
    expect(onSelectGhost).not.toHaveBeenCalled();
    expect(getByTestId('ghost-roster')).toBeTruthy(); // roster is now visible
    fireEvent.click(getByTestId('ghost-roster-start')); // Start commits the selection
    expect(onSelectGhost).toHaveBeenCalled();
  });

  it('ghost picker: a single-live-rider race skips the roster and commits on the second tap', () => {
    const onSelectGhost = vi.fn();
    const candidates = [{
      raceId: '20260605110000', day: '2026-06-05', timeOfDay: '11:00 am',
      participants: [{ id: 'milo', displayName: 'Milo', avatarSrc: '/x', isGhost: false }],
      winnerName: 'Milo'
    }];
    const { getByTestId, queryByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} ghostCandidates={candidates} onSelectGhost={onSelectGhost} />
    );
    fireEvent.click(getByTestId('course-ghost'));
    const card = getByTestId('ghost-20260605110000');
    fireEvent.click(card); // focus
    fireEvent.click(card); // single live rider → commit directly, no roster step
    expect(queryByTestId('ghost-roster')).toBeNull();
    expect(onSelectGhost).toHaveBeenCalledTimes(1);
    expect(onSelectGhost.mock.calls[0][0].participants.map((p) => p.id)).toEqual(['milo']);
  });

  // Helper: open the roster for a candidate (two taps on its card).
  const openRoster = (candidate) => {
    const utils = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} ghostCandidates={[candidate]} onSelectGhost={vi.fn()} />
    );
    fireEvent.click(utils.getByTestId('course-ghost'));
    const card = utils.getByTestId(`ghost-${candidate.raceId}`);
    fireEvent.click(card);
    fireEvent.click(card);
    return utils;
  };

  it('roster: only live riders are selectable; ghosts are shown locked, never committed', () => {
    const onSelectGhost = vi.fn();
    const candidate = {
      raceId: '20260604120000', day: '2026-06-04', timeOfDay: '12:00 pm', winnerName: 'Milo',
      participants: [
        { id: 'milo', displayName: 'Milo', avatarSrc: '/m', isGhost: false },
        { id: 'felix', displayName: 'Felix', avatarSrc: '/f', isGhost: false },
        { id: 'ghost:20260601:alan', displayName: 'Alan 👻', avatarSrc: '/a', isGhost: true }
      ]
    };
    const { getByTestId, getAllByTestId, queryAllByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} ghostCandidates={[candidate]} onSelectGhost={onSelectGhost} />
    );
    fireEvent.click(getByTestId('course-ghost'));
    const card = getByTestId('ghost-20260604120000');
    fireEvent.click(card); fireEvent.click(card); // focus, then open roster

    // Two live riders are tappable items; the one ghost is a locked, non-item tile.
    expect(getAllByTestId('ghost-roster-item')).toHaveLength(2);
    const ghostTile = getAllByTestId('ghost-roster-ghost');
    expect(ghostTile).toHaveLength(1);
    expect(ghostTile[0].className).toContain('is-locked');
    expect(ghostTile[0].querySelector('.cg-ghost')).toBeTruthy(); // ghost css class applied
    expect(queryAllByTestId('ghost-roster-item')).not.toContain(ghostTile[0]);

    // Default = all live in → "Race both" (two riders). Commit passes only live.
    const cta = getByTestId('ghost-roster-start');
    expect(cta.textContent).toContain('Race both');
    fireEvent.click(cta);
    const committed = onSelectGhost.mock.calls[0][0].participants;
    expect(committed.map((p) => p.id)).toEqual(['milo', 'felix']);
  });

  it('roster: tapping a rider narrows the dynamic CTA and the committed field', () => {
    const onSelectGhost = vi.fn();
    const candidate = {
      raceId: '20260604130000', day: '2026-06-04', timeOfDay: '1:00 pm', winnerName: 'Milo',
      participants: [
        { id: 'milo', displayName: 'Milo', avatarSrc: '/m', isGhost: false },
        { id: 'felix', displayName: 'Felix', avatarSrc: '/f', isGhost: false }
      ]
    };
    const { getByTestId, getAllByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} ghostCandidates={[candidate]} onSelectGhost={onSelectGhost} />
    );
    fireEvent.click(getByTestId('course-ghost'));
    const card = getByTestId('ghost-20260604130000');
    fireEvent.click(card); fireEvent.click(card);

    const cta = getByTestId('ghost-roster-start');
    expect(cta.textContent).toContain('Race both');
    // Toggle Felix (second item) off → exactly one selected, CTA shows the name.
    fireEvent.click(getAllByTestId('ghost-roster-item')[1]);
    expect(cta.textContent).toContain('Race Milo');
    fireEvent.click(cta);
    expect(onSelectGhost.mock.calls[0][0].participants.map((p) => p.id)).toEqual(['milo']);
  });

  it('roster: CTA is disabled when no riders are selected', () => {
    // Two live riders so the roster opens (a single-rider race auto-commits).
    const candidate = {
      raceId: '20260604140000', day: '2026-06-04', timeOfDay: '2:00 pm', winnerName: 'Milo',
      participants: [
        { id: 'milo', displayName: 'Milo', avatarSrc: '/m', isGhost: false },
        { id: 'felix', displayName: 'Felix', avatarSrc: '/f', isGhost: false }
      ]
    };
    const { getByTestId, getAllByTestId } = openRoster(candidate);
    const cta = getByTestId('ghost-roster-start');
    expect(cta.disabled).toBe(false);
    getAllByTestId('ghost-roster-item').forEach((item) => fireEvent.click(item)); // deselect every rider
    expect(cta.textContent).toContain('Pick a rider');
    expect(cta.disabled).toBe(true);
  });

  it('disables Start until canStart, then fires onStart', () => {
    const onStart = vi.fn();
    const { getByTestId, rerender } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} onStart={onStart} canStart={false} />
    );
    const start = getByTestId('cycle-game-start');
    expect(start.disabled).toBe(true);
    fireEvent.click(start);
    expect(onStart).not.toHaveBeenCalled();
    rerender(<CycleGameHome bikes={bikes} people={people} records={[]} onStart={onStart} canStart />);
    fireEvent.click(getByTestId('cycle-game-start'));
    expect(onStart).toHaveBeenCalled();
  });

  it('does NOT render a cancel control on the home screen', () => {
    const { queryByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} />
    );
    expect(queryByTestId('cycle-game-cancel')).toBeNull();
  });

  it('shows "No races yet" when records are empty, and a History row when present', () => {
    const { getByText, getByTestId, rerender } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} />
    );
    expect(getByText('No races yet')).toBeTruthy();
    rerender(
      <CycleGameHome
        bikes={bikes}
        people={people}
        records={[{
          raceId: '20260602150118', winnerId: 'milo', winnerName: 'Milo',
          winnerAvatar: '/api/v1/static/img/users/milo', others: [],
          speedLabel: '31 km/h', raceLabel: '3 km', raceKind: 'distance', whenDay: 'Today', whenTime: '3:01p'
        }]}
      />
    );
    const row = getByTestId('record-20260602150118');
    expect(row).toHaveTextContent('Milo');
    expect(row).toHaveTextContent('31 km/h');
    expect(row).toHaveTextContent('3 km');
    // The day is now a once-per-day group header (not repeated on every row);
    // the row itself carries only the clock time.
    expect(row).toHaveTextContent('3:01p');
    expect(row).not.toHaveTextContent('Today');
    expect(getByText('Today').className).toContain('cgh-records__day');
  });

  it('History groups rows by day: one header per day, time-only rows', () => {
    const mk = (raceId, whenDay, whenTime) => ({
      raceId, winnerId: 'milo', winnerName: 'Milo', winnerAvatar: '/m', others: [],
      speedLabel: '28 km/h', raceLabel: '1 km', raceKind: 'distance', whenDay, whenTime
    });
    const { container } = render(
      <CycleGameHome bikes={bikes} people={people} records={[
        mk('20260605120000', 'Today', '12:00p'),
        mk('20260605110000', 'Today', '11:00a'),
        mk('20260604180000', 'Yest', '6:00p')
      ]} />
    );
    const headers = [...container.querySelectorAll('.cgh-records__day')].map((el) => el.textContent);
    expect(headers).toEqual(['Today', 'Yest']); // two same-day rows collapse to one header
  });

  it('renders the History table: winner, SPEED + RACE columns, and when', () => {
    const records = [{
      raceId: 'r1', winnerId: 'milo', winnerName: 'Milo', winnerAvatar: '/a',
      others: [{ id: 'felix', displayName: 'Felix', avatarSrc: '/b' }],
      speedLabel: '32 km/h', raceLabel: '1.00 km', raceKind: 'distance', whenDay: 'Today', whenTime: '6:12p'
    }];
    const { getByTestId } = render(<CycleGameHome bikes={bikes} people={people} records={records} />);
    const row = getByTestId('record-r1');
    expect(row.querySelector('[data-col="speed"]')).toHaveTextContent('32 km/h');
    expect(row.querySelector('[data-col="race"]')).toHaveTextContent('1.00 km');
    // section renamed to History
    expect(getByTestId('cycle-game-records')).toHaveTextContent('History');
  });

  it('renders an explained placeholder when the race produced no speed', () => {
    const records = [{
      raceId: 'r-noscore', winnerId: 'milo', winnerName: 'Milo', winnerAvatar: '/a', others: [],
      speedLabel: null, raceLabel: '3 km', raceKind: 'distance', whenDay: 'Today', whenTime: ''
    }];
    const { getByTitle } = render(
      <CycleGameHome bikes={bikes} people={people} records={records} />
    );
    expect(getByTitle('No result recorded')).toBeTruthy();
  });

  it('History rows are clickable and fire onSelectRecord with the raceId', () => {
    const onSelectRecord = vi.fn();
    const records = [{
      raceId: '20260603120000', winnerId: 'milo', winnerName: 'Milo', winnerAvatar: '/a',
      others: [], speedLabel: '30 km/h', raceLabel: '3 km', raceKind: 'distance', whenDay: 'Today', whenTime: ''
    }];
    const { getByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={records} onSelectRecord={onSelectRecord} />
    );
    fireEvent.click(getByTestId('record-20260603120000'));
    expect(onSelectRecord).toHaveBeenCalledWith('20260603120000');
  });

  // NOTE: the History redesign replaced rail avatars with a crowned winner name
  // (ghost faces now live in the Recap), so the former "ghost avatars in a record"
  // tint test was removed — the rail no longer renders .cgh-record__avatar.

  it('closes the rider picker on Escape', () => {
    const { getByTestId, queryByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} />
    );
    fireEvent.click(getByTestId('bike-tricycle').querySelector('.cgh-slot__main'));
    expect(getByTestId('rider-picker')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(queryByTestId('rider-picker')).toBeNull();
  });

  it('closes the ghost picker on Escape', () => {
    const { getByTestId, queryByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} ghostCandidates={[]} />
    );
    fireEvent.click(getByTestId('course-ghost'));
    expect(getByTestId('ghost-picker')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(queryByTestId('ghost-picker')).toBeNull();
  });

  it('volume lives behind an icon that opens a modal with a numeric readout', () => {
    const { getByTestId, queryByTestId, rerender } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} masterVolume={0.7} />
    );
    // Closed by default — only the icon shows in the rail.
    expect(queryByTestId('cycle-game-volume-modal')).toBeNull();
    expect(getByTestId('cycle-game-volume-open')).toBeTruthy();
    fireEvent.click(getByTestId('cycle-game-volume-open'));
    expect(getByTestId('cycle-game-volume-modal')).toBeTruthy();
    expect(getByTestId('cycle-game-volume-readout').textContent).toBe('70%');
    rerender(
      <CycleGameHome bikes={bikes} people={people} records={[]} masterVolume={0.7} masterMuted />
    );
    expect(getByTestId('cycle-game-volume-readout').textContent).toBe('Muted');
  });

  it('high scores: render above history and tap into the recap like a record', () => {
    const onSelectRecord = vi.fn();
    const highScores = [
      { key: 'sprint', label: 'Fastest <5 min', valueLabel: '36.0 km/h', raceId: 'R1', holderName: 'Milo', holderAvatar: '/m' },
      { key: 'endurance', label: 'Fastest 5 min+', valueLabel: '40.0 km/h', raceId: 'R2', holderName: 'Felix', holderAvatar: '/f' }
    ];
    const { getByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} highScores={highScores} onSelectRecord={onSelectRecord} />
    );
    expect(getByTestId('cycle-game-highscores')).toBeTruthy();
    expect(getByTestId('highscore-sprint').textContent).toContain('36.0 km/h');
    expect(getByTestId('highscore-endurance').textContent).toContain('40.0 km/h');
    fireEvent.click(getByTestId('highscore-sprint'));
    expect(onSelectRecord).toHaveBeenCalledWith('R1');
  });

  it('high scores: section is omitted when there are none', () => {
    const { queryByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} highScores={[]} />
    );
    expect(queryByTestId('cycle-game-highscores')).toBeNull();
  });

  it('shows a lane number on every grid slot and an add-rider hint on empty slots', () => {
    const { getByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} />
    );
    expect(getByTestId('bike-cycle_ace').querySelector('.cgh-slot__lane')).toBeTruthy();
    expect(getByTestId('bike-tricycle').querySelector('.cgh-slot__lane')).toBeTruthy();
    // empty slot advertises how to fill it; filled slot does not
    expect(getByTestId('bike-tricycle').querySelector('.cgh-slot__add')).toBeTruthy();
    expect(getByTestId('bike-cycle_ace').querySelector('.cgh-slot__add')).toBeNull();
  });

  it('renders the featured-course card and forwards Ride It', () => {
    const onRideFeatured = vi.fn();
    const featured = {
      course: { id: 'sprint-1500m', label: 'Sprint 1500', win_condition: 'distance', goal_m: 1500 },
      week: { start: '2026-06-29', end: '2026-07-06' },
      standings: [{ userId: 'dad', bestValue: 150, raceId: 'r1', attempts: 1 }],
      allTimeRecord: null
    };
    const { getByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} featured={featured} onRideFeatured={onRideFeatured} />
    );
    fireEvent.click(getByTestId('featured-ride'));
    expect(onRideFeatured).toHaveBeenCalledTimes(1);
    // REGRESSION GUARD: the card must live inside the records rail, NEVER the
    // main column — there it displaced the picker/grid/start on the fixed-height
    // unscrollable garage touchscreen and made the lobby unusable (2026-07-02).
    const card = getByTestId('featured-course-card');
    expect(getByTestId('cycle-game-records').contains(card)).toBe(true);
  });

  it('renders no featured card when the ladder is unavailable', () => {
    const { queryByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} featured={null} />
    );
    expect(queryByTestId('featured-course-card')).toBeNull();
  });

  it('applies is-focused class on the first-tapped ghost card', () => {
    const candidates = [{
      raceId: '20260602150118', day: '2026-06-02', timeOfDay: '3:01 pm',
      participants: [{ id: 'milo', displayName: 'Milo', avatarSrc: '/x' }],
      goalKind: 'distance', goalLabel: '3 km', scoreKind: 'time', scoreLabel: '4:12'
    }];
    const { getByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} ghostCandidates={candidates} />
    );
    fireEvent.click(getByTestId('course-ghost'));        // open the ghost picker
    const card = getByTestId('ghost-20260602150118');
    expect(card.classList.contains('is-focused')).toBe(false); // nothing focused yet
    fireEvent.click(card);                               // first tap focuses
    expect(card.classList.contains('is-focused')).toBe(true);
  });

  it('shows the recovered-race banner and self-dismisses after 8s (audit C1 follow-up)', () => {
    vi.useFakeTimers();
    try {
      const { getByTestId, queryByTestId } = render(
        <CycleGameHome bikes={bikes} people={people} records={[]}
          recoveredNotice="Recovered your interrupted race — saved to history" />
      );
      const banner = getByTestId('cycle-recovered-banner');
      expect(banner.textContent).toContain('Recovered your interrupted race');
      act(() => { vi.advanceTimersByTime(7999); });
      expect(queryByTestId('cycle-recovered-banner')).toBeTruthy();
      act(() => { vi.advanceTimersByTime(2); });
      expect(queryByTestId('cycle-recovered-banner')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders no banner when recoveredNotice is absent', () => {
    const { queryByTestId } = render(<CycleGameHome bikes={bikes} people={people} records={[]} />);
    expect(queryByTestId('cycle-recovered-banner')).toBeNull();
  });
});
