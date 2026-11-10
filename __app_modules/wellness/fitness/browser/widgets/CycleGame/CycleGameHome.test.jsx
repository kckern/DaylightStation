import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act, cleanup } from '@testing-library/react';
import CycleGameHome from "./CycleGameHome.jsx";
import * as uiLogMod from "./home/uiLog.js";

const bikes = [
  { id: 'cycle_ace', name: 'CycleAce', rider: 'user_3' },
  { id: 'tricycle', name: 'Tricycle', rider: null }
];
const people = [
  { id: 'user_3', name: 'User_3', avatarSrc: '/api/v1/static/img/users/user_3', heartRate: 130, zoneId: 'hot', zoneColor: 'orange', hasHR: true },
  { id: 'user_2', name: 'User_2', avatarSrc: '/api/v1/static/img/users/user_2', heartRate: null, zoneId: null, zoneColor: null, hasHR: false }
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
    // the rider's name sits under the filled slot (guests share an avatar)
    const filled = getByTestId('bike-cycle_ace');
    expect(filled.querySelector('.cgh-slot__device')).toBeTruthy();
    expect(filled.querySelector('.cgh-slot__rider-avatar')).toBeTruthy();
    expect(filled.querySelector('.cgh-slot__name').textContent).toBe('User_3');
    // an empty slot has no rider avatar, still has the equipment hero
    const empty = getByTestId('bike-tricycle');
    expect(empty.querySelector('.cgh-slot__rider-avatar')).toBeNull();
    expect(empty.querySelector('.cgh-slot__name')).toBeNull();
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
    fireEvent.click(getByTestId('assign-user_2'));
    expect(onAssign).toHaveBeenCalledWith('tricycle', 'user_2');
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
      { id: 'user_3', name: 'User_3', hasHR: false, isGuest: false },
      { id: 'user_7', name: 'User_7', hasHR: false, isGuest: true }
    ];
    const { getByTestId, queryByTestId, getByRole } = render(
      <CycleGameHome bikes={bikes} people={mixed} records={[]} />
    );
    fireEvent.click(getByTestId('bike-tricycle').querySelector('.cgh-slot__main'));
    // household tab is default: User_3 present, User_7 (guest) hidden
    expect(getByTestId('assign-user_3')).toBeTruthy();
    expect(queryByTestId('assign-user_7')).toBeNull();
    // switch to Guests tab → User_7 appears
    fireEvent.click(getByRole('tab', { name: 'Guests' }));
    expect(getByTestId('assign-user_7')).toBeTruthy();
  });

  it('ghost picker: first tap focuses a card, second tap opens the roster submenu', () => {
    const onSelectGhost = vi.fn();
    // Multi-rider race: the second tap opens the roster (single-rider races skip it —
    // covered separately below).
    const candidates = [{
      raceId: '20260602150118', day: '2026-06-02', timeOfDay: '3:01 pm',
      participants: [
        { id: 'user_3', displayName: 'User_3', avatarSrc: '/x', isGhost: false },
        { id: 'user_2', displayName: 'User_2', avatarSrc: '/f', isGhost: false }
      ],
      winnerName: 'User_3', goalKind: 'distance', goalLabel: '3 km', scoreKind: 'time', scoreLabel: '4:12'
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
      participants: [{ id: 'user_3', displayName: 'User_3', avatarSrc: '/x', isGhost: false }],
      winnerName: 'User_3'
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
    expect(onSelectGhost.mock.calls[0][0].participants.map((p) => p.id)).toEqual(['user_3']);
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
      raceId: '20260604120000', day: '2026-06-04', timeOfDay: '12:00 pm', winnerName: 'User_3',
      participants: [
        { id: 'user_3', displayName: 'User_3', avatarSrc: '/m', isGhost: false },
        { id: 'user_2', displayName: 'User_2', avatarSrc: '/f', isGhost: false },
        { id: 'ghost:20260601:user_4', displayName: 'User_4 👻', avatarSrc: '/a', isGhost: true }
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
    expect(committed.map((p) => p.id)).toEqual(['user_3', 'user_2']);
  });

  it('roster: tapping a rider narrows the dynamic CTA and the committed field', () => {
    const onSelectGhost = vi.fn();
    const candidate = {
      raceId: '20260604130000', day: '2026-06-04', timeOfDay: '1:00 pm', winnerName: 'User_3',
      participants: [
        { id: 'user_3', displayName: 'User_3', avatarSrc: '/m', isGhost: false },
        { id: 'user_2', displayName: 'User_2', avatarSrc: '/f', isGhost: false }
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
    // Toggle User_2 (second item) off → exactly one selected, CTA shows the name.
    fireEvent.click(getAllByTestId('ghost-roster-item')[1]);
    expect(cta.textContent).toContain('Race User_3');
    fireEvent.click(cta);
    expect(onSelectGhost.mock.calls[0][0].participants.map((p) => p.id)).toEqual(['user_3']);
  });

  it('roster: CTA is disabled when no riders are selected', () => {
    // Two live riders so the roster opens (a single-rider race auto-commits).
    const candidate = {
      raceId: '20260604140000', day: '2026-06-04', timeOfDay: '2:00 pm', winnerName: 'User_3',
      participants: [
        { id: 'user_3', displayName: 'User_3', avatarSrc: '/m', isGhost: false },
        { id: 'user_2', displayName: 'User_2', avatarSrc: '/f', isGhost: false }
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

  it('does NOT render a race menu (the stop control) on the home screen', () => {
    const { queryByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} />
    );
    expect(queryByTestId('race-menu-open')).toBeNull();
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
          raceId: '20260602150118', winnerId: 'user_3', winnerName: 'User_3',
          winnerAvatar: '/api/v1/static/img/users/user_3', others: [],
          speedLabel: '31 km/h', raceLabel: '3 km', raceKind: 'distance', whenDay: 'Today', whenTime: '3:01p'
        }]}
      />
    );
    const row = getByTestId('record-20260602150118');
    expect(row).toHaveTextContent('User_3');
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
      raceId, winnerId: 'user_3', winnerName: 'User_3', winnerAvatar: '/m', others: [],
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
      raceId: 'r1', winnerId: 'user_3', winnerName: 'User_3', winnerAvatar: '/a',
      others: [{ id: 'user_2', displayName: 'User_2', avatarSrc: '/b' }],
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
      raceId: 'r-noscore', winnerId: 'user_3', winnerName: 'User_3', winnerAvatar: '/a', others: [],
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
      raceId: '20260603120000', winnerId: 'user_3', winnerName: 'User_3', winnerAvatar: '/a',
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
      { key: 'sprint', label: 'Fastest <5 min', valueLabel: '36.0 km/h', raceId: 'R1', holderName: 'User_3', holderAvatar: '/m' },
      { key: 'endurance', label: 'Fastest 5 min+', valueLabel: '40.0 km/h', raceId: 'R2', holderName: 'User_2', holderAvatar: '/f' }
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

  // audit C6 / user feedback 2026-07-02: a selected ghost used to be
  // invisible until the race screen mounted — it now lines up in the SAME
  // starting grid as the real bikes.
  it('shows a phantom grid slot for each selected ghost rider, alongside the real bikes', () => {
    const ghostRoster = [
      { userId: 'ghost:20260701120000:user_1', displayName: 'KC 👻', avatarSrc: '/api/v1/static/img/users/kckern' }
    ];
    const { getByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} ghostRoster={ghostRoster} />
    );
    // Real bikes still render.
    expect(getByTestId('bike-cycle_ace')).toBeTruthy();
    expect(getByTestId('bike-tricycle')).toBeTruthy();
    // The ghost gets its own lane in the same grid.
    const ghostSlot = getByTestId('ghost-slot-ghost:20260701120000:user_1');
    expect(ghostSlot.textContent).toContain('KC 👻');
    expect(ghostSlot.className).toContain('cgh-slot--ghost');
  });

  it('does not render any ghost slot when no ghost is selected', () => {
    const { queryByTestId } = render(
      <CycleGameHome bikes={bikes} people={people} records={[]} />
    );
    expect(queryByTestId(/ghost-slot-/)).toBeNull();
  });

  it('shows the ghost lane even with zero physical bikes (never the "no bikes" empty state)', () => {
    const ghostRoster = [
      { userId: 'ghost:20260701120000:user_1', displayName: 'KC 👻', avatarSrc: '/api/v1/static/img/users/kckern' }
    ];
    const { getByTestId, queryByText } = render(
      <CycleGameHome bikes={[]} people={people} records={[]} ghostRoster={ghostRoster} />
    );
    expect(getByTestId('ghost-slot-ghost:20260701120000:user_1')).toBeTruthy();
    expect(queryByText(/No bikes detected/i)).toBeNull();
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
      participants: [{ id: 'user_3', displayName: 'User_3', avatarSrc: '/x' }],
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

describe('CycleGameHome — busy (a start is pending)', () => {
  const record = { raceId: '20260101100000', winnerId: 'user_3', winnerName: 'User_3', winnerAvatar: '/a', others: [],
    speedLabel: '30 km/h', raceLabel: '1.00 km', raceKind: 'distance', whenDay: 'Today', whenTime: '6:12p' };
  const highScore = { key: 'furthest', raceId: '20260101100000', label: 'Furthest', valueLabel: '1.00 km', holderName: 'User_3' };
  const ladder = { course: { id: 'course-3k', name: 'Course', win_condition: 'distance', goal_m: 3000 }, standings: [] };
  const handlers = () => ({
    onSelectRaceType: vi.fn(), onSetRaceValue: vi.fn(), onAssign: vi.fn(), onUnassign: vi.fn(),
    onSelectRecord: vi.fn(), onSelectGhost: vi.fn(), onClearGhost: vi.fn(), onSetMasterVolume: vi.fn(),
    onStart: vi.fn(), onRideFeatured: vi.fn()
  });
  const renderHome = (props = {}) => {
    const h = handlers();
    const view = render(
      <CycleGameHome bikes={bikes} people={people} records={[record]} highScores={[highScore]} featured={ladder}
        raceType="distance" raceValue={1000} canStart {...h} {...props} />
    );
    return { ...view, h };
  };

  it('is not busy by default: Start reads "Start race" and works', () => {
    const { getByTestId, h } = renderHome();
    expect(getByTestId('cycle-game-home').getAttribute('aria-busy')).toBe('false');
    expect(getByTestId('cycle-game-start').textContent).toContain('Start race');
    fireEvent.click(getByTestId('cycle-game-start'));
    expect(h.onStart).toHaveBeenCalledTimes(1);
  });

  it('marks the lobby aria-busy and the Start button reads "Starting…" and is disabled', () => {
    const { getByTestId, h } = renderHome({ busy: true });
    expect(getByTestId('cycle-game-home').getAttribute('aria-busy')).toBe('true');
    const start = getByTestId('cycle-game-start');
    expect(start.textContent).toContain('Starting…');
    expect(start.disabled).toBe(true);
    fireEvent.click(start);
    expect(h.onStart).not.toHaveBeenCalled();
  });

  it('race-type tiles, presets and the stepper are inert', () => {
    const { getByTestId, container, queryByTestId, h } = renderHome({ busy: true });
    ['course-distance', 'course-time', 'course-ghost', 'tier-sprint', 'tier-long'].forEach((id) => {
      expect(getByTestId(id).disabled).toBe(true);
      fireEvent.click(getByTestId(id));
    });
    container.querySelectorAll('[data-testid="cgh-value"] button').forEach((b) => {
      expect(b.disabled).toBe(true);
      fireEvent.click(b);
    });
    expect(h.onSelectRaceType).not.toHaveBeenCalled();
    expect(h.onSetRaceValue).not.toHaveBeenCalled();
    expect(queryByTestId('ghost-picker')).toBeNull();
  });

  it('a selected ghost cannot be changed or removed', () => {
    const ghost = { sourceRaceId: 'r1', winCondition: 'distance', goalM: 1000, displayName: 'User_3', riders: [] };
    const { getByTestId, queryByTestId, h } = renderHome({ busy: true, ghost });
    getByTestId('cgh-ghost-summary').querySelectorAll('button').forEach((b) => {
      expect(b.disabled).toBe(true);
      fireEvent.click(b);
    });
    expect(h.onClearGhost).not.toHaveBeenCalled();
    expect(queryByTestId('ghost-picker')).toBeNull();
  });

  it('bike slots do not open the rider picker', () => {
    const { getByTestId, queryByTestId } = renderHome({ busy: true });
    ['bike-cycle_ace', 'bike-tricycle'].forEach((id) => {
      const btn = getByTestId(id).querySelector('button');
      expect(btn.disabled).toBe(true);
      fireEvent.click(btn);
    });
    expect(queryByTestId('rider-picker')).toBeNull();
  });

  it('the featured "Ride it" button is inert', () => {
    const { getByTestId, h } = renderHome({ busy: true });
    expect(getByTestId('featured-ride').disabled).toBe(true);
    fireEvent.click(getByTestId('featured-ride'));
    expect(h.onRideFeatured).not.toHaveBeenCalled();
  });

  it('history rows and high-score cards do not open a recap', () => {
    const { getByTestId, h } = renderHome({ busy: true });
    ['record-20260101100000', 'highscore-furthest'].forEach((id) => {
      expect(getByTestId(id).disabled).toBe(true);
      fireEvent.click(getByTestId(id));
    });
    expect(h.onSelectRecord).not.toHaveBeenCalled();
  });

  it('the volume button does not open the volume modal', () => {
    const { getByTestId, queryByTestId } = renderHome({ busy: true });
    expect(getByTestId('cycle-game-volume-open').disabled).toBe(true);
    fireEvent.click(getByTestId('cycle-game-volume-open'));
    expect(queryByTestId('cycle-game-volume-modal')).toBeNull();
  });

  it('a picker that was already open stays mounted but cannot commit a change', () => {
    const { getByTestId, rerender, h } = renderHome();
    fireEvent.click(getByTestId('bike-tricycle').querySelector('button'));
    const picker = document.querySelector('.cgh-picker');
    expect(picker).toBeTruthy();
    rerender(
      <CycleGameHome bikes={bikes} people={people} records={[record]} highScores={[highScore]} featured={ladder}
        raceType="distance" raceValue={1000} canStart {...h} busy />
    );
    expect(document.querySelector('.cgh-picker')).toBeTruthy();
    document.querySelectorAll('.cgh-picker button').forEach((b) => fireEvent.click(b));
    expect(h.onAssign).not.toHaveBeenCalled();
    expect(h.onUnassign).not.toHaveBeenCalled();
  });

  // Each picker is opened first, then the lobby turns busy: the open picker
  // stays on screen and every way it could commit a change does nothing.
  describe('pickers that were already open when the lobby turned busy', () => {
    const candidate = {
      raceId: '20260605110000', day: '2026-06-05', timeOfDay: '11:00 am',
      participants: [{ id: 'user_3', displayName: 'User_3', avatarSrc: '/x', isGhost: false }],
      winnerName: 'User_3', goalKind: 'distance', goalLabel: '1 km', scoreKind: 'time', scoreLabel: '2:00'
    };
    const currentGhost = { sourceRaceId: 'r1', winCondition: 'distance', goalM: 1000, displayName: 'User_3', riders: [] };
    const home = (h, extra = {}) => (
      <CycleGameHome bikes={bikes} people={people} records={[record]} highScores={[highScore]} featured={ladder}
        raceType="distance" raceValue={1000} canStart ghostCandidates={[candidate]} {...h} {...extra} />
    );

    it('an open rider picker cannot assign a rider', () => {
      const h = handlers();
      const { getByTestId, rerender } = render(home(h));
      fireEvent.click(getByTestId('bike-tricycle').querySelector('button'));
      rerender(home(h, { busy: true }));
      fireEvent.click(getByTestId('assign-user_2'));
      expect(h.onAssign).not.toHaveBeenCalled();
      expect(getByTestId('rider-picker')).toBeTruthy(); // still open: nothing was committed
    });

    it('an open rider picker cannot clear the rider', () => {
      const h = handlers();
      const { getByTestId, rerender } = render(home(h));
      fireEvent.click(getByTestId('bike-cycle_ace').querySelector('button'));
      rerender(home(h, { busy: true }));
      fireEvent.click(getByTestId('rider-clear'));
      expect(h.onUnassign).not.toHaveBeenCalled();
      expect(getByTestId('rider-picker')).toBeTruthy();
    });

    it('an open ghost picker cannot select a ghost', () => {
      const h = handlers();
      const { getByTestId, rerender } = render(home(h));
      fireEvent.click(getByTestId('course-ghost'));
      fireEvent.click(getByTestId('ghost-20260605110000')); // focus
      rerender(home(h, { busy: true }));
      fireEvent.click(getByTestId('ghost-20260605110000')); // would commit
      expect(h.onSelectGhost).not.toHaveBeenCalled();
      expect(getByTestId('ghost-picker')).toBeTruthy();
    });

    it('an open ghost picker cannot remove the ghost', () => {
      const h = handlers();
      const { getByTestId, rerender } = render(home(h, { ghost: currentGhost }));
      fireEvent.click(getByTestId('cgh-ghost-summary').querySelector('button')); // "change" opens the picker
      expect(getByTestId('ghost-picker')).toBeTruthy();
      rerender(home(h, { ghost: currentGhost, busy: true }));
      fireEvent.click(getByTestId('ghost-clear'));
      expect(h.onClearGhost).not.toHaveBeenCalled();
    });

    it('an open volume modal cannot set the volume', () => {
      const h = handlers();
      const { getByTestId, rerender } = render(home(h));
      fireEvent.click(getByTestId('cycle-game-volume-open'));
      const press = () => getByTestId('cycle-game-volume').querySelectorAll('button').forEach((b) => fireEvent.click(b));
      press();
      expect(h.onSetMasterVolume).toHaveBeenCalled(); // the buttons do work when the lobby is live
      h.onSetMasterVolume.mockClear();
      rerender(home(h, { busy: true }));
      press();
      expect(h.onSetMasterVolume).not.toHaveBeenCalled();
    });
  });
});

describe('CycleGameHome — history row labels', () => {
  const row = (over = {}) => ({ raceId: '20260101100000', winnerId: 'user_3', winnerName: 'User_3', winnerAvatar: '/a', others: [],
    speedLabel: '30 km/h', speedKind: 'speed', raceLabel: '1.00 km', raceKind: 'distance', whenDay: 'Today', whenTime: '6:12p', ...over });
  const renderRow = (over) => render(<CycleGameHome bikes={bikes} people={people} records={[row(over)]} />)
    .getByTestId('record-20260101100000');

  it('names the row after its lead rider, or "Lead rider" when the record has no name', () => {
    expect(renderRow().getAttribute('aria-label')).toBe('User_3 — 30 km/h, 1.00 km, Today 6:12p');
    cleanup();
    expect(renderRow({ winnerName: undefined }).getAttribute('aria-label')).toBe('Lead rider — 30 km/h, 1.00 km, Today 6:12p');
  });

  it('a pace is shown as a plain speed', () => {
    const cell = renderRow().querySelector('[data-col="speed"]');
    expect(cell.textContent).toBe('30 km/h');
    expect(cell.getAttribute('data-kind')).toBe('speed');
    expect(cell.getAttribute('aria-label')).toBeNull();
    expect(cell.getAttribute('title')).toBeNull();
  });

  it('a distance in the Speed column says it is the distance ridden, not a speed', () => {
    const btn = renderRow({ speedLabel: '640 m', speedKind: 'distance' });
    const cell = btn.querySelector('[data-col="speed"]');
    expect(cell.textContent).toBe('640 m'); // the value keeps its unit
    expect(cell.getAttribute('data-kind')).toBe('distance');
    expect(cell.getAttribute('aria-label')).toBe('640 m ridden, did not finish');
    expect(cell.getAttribute('title')).toBe('Distance ridden (did not finish)');
    expect(btn.getAttribute('aria-label')).toBe('User_3 — 640 m ridden, did not finish, 1.00 km, Today 6:12p');
  });
});

describe('CycleGameHome — sensor check', () => {
  const mk = (a, b) => ([
    { id: 'bike_a', name: 'Bike A', rider: 'user_3', sensorLive: a },
    { id: 'bike_b', name: 'Bike B', rider: 'user_2', sensorLive: b },
    { id: 'bike_c', name: 'Bike C', rider: null, sensorLive: false }
  ]);
  const view = (bikesProp, props = {}) => {
    const onStart = vi.fn();
    const ui = (b, p = {}) => (
      <CycleGameHome bikes={b} people={people} records={[]} canStart onStart={onStart} {...props} {...p} />
    );
    const r = render(ui(bikesProp));
    return { ...r, onStart, again: (b, p) => r.rerender(ui(b, p)) };
  };

  it('a claimed bike with no signal shows the No signal label and class; unclaimed shows nothing', () => {
    const { getByTestId } = view(mk(false, true));
    const a = getByTestId('bike-bike_a');
    expect(a.className).toContain('is-no-signal');
    expect(a.textContent).toContain('No signal');
    expect(a.textContent).not.toContain('Ready');
    const c = getByTestId('bike-bike_c');
    expect(c.className).not.toContain('is-no-signal');
    expect(c.textContent).not.toContain('No signal');
    expect(c.textContent).not.toContain('Ready');
  });

  it('a claimed live bike shows Ready; unknown sensor state shows neither', () => {
    const { getByTestId } = view(mk(true, undefined));
    expect(getByTestId('bike-bike_a').textContent).toContain('Ready');
    const b = getByTestId('bike-bike_b');
    expect(b.textContent).not.toContain('Ready');
    expect(b.textContent).not.toContain('No signal');
    expect(b.className).not.toContain('is-no-signal');
  });

  it('Start with a silent claimed bike does not start and shows the warning', () => {
    const { getByTestId, onStart } = view(mk(false, true));
    fireEvent.click(getByTestId('cycle-game-start'));
    expect(onStart).not.toHaveBeenCalled();
    const w = getByTestId('sensor-warning');
    expect(w.getAttribute('role')).toBe('alert');
    expect(w.textContent).toContain('Bike A is not reporting. Spin the pedals once, or check the sensor.');
  });

  it('names two silent bikes with "and"', () => {
    const { getByTestId } = view(mk(false, false));
    fireEvent.click(getByTestId('cycle-game-start'));
    expect(getByTestId('sensor-warning').textContent).toContain('Bike A and Bike B are not reporting.');
  });

  it('names three or more silent bikes with commas and "and"', () => {
    const three = [
      { id: 'bike_a', name: 'Bike A', rider: 'user_3', sensorLive: false },
      { id: 'bike_b', name: 'Bike B', rider: 'user_2', sensorLive: false },
      { id: 'bike_c', name: 'Bike C', rider: 'user_2', sensorLive: false }
    ];
    const { getByTestId } = view(three);
    fireEvent.click(getByTestId('cycle-game-start'));
    expect(getByTestId('sensor-warning').textContent).toContain('Bike A, Bike B and Bike C are not reporting.');
  });

  it('Start anyway starts; Back dismisses without starting', () => {
    const { getByTestId, queryByTestId, onStart } = view(mk(false, true));
    fireEvent.click(getByTestId('cycle-game-start'));
    fireEvent.click(getByTestId('sensor-warning-back'));
    expect(queryByTestId('sensor-warning')).toBeNull();
    expect(onStart).not.toHaveBeenCalled();
    fireEvent.click(getByTestId('cycle-game-start'));
    fireEvent.click(getByTestId('sensor-warning-start'));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('all claimed bikes live, or sensor state unknown, starts at once', () => {
    const a = view(mk(true, true));
    fireEvent.click(a.getByTestId('cycle-game-start'));
    expect(a.onStart).toHaveBeenCalledTimes(1);
    expect(a.queryByTestId('sensor-warning')).toBeNull();
    cleanup();
    const b = view(mk(undefined, undefined));
    fireEvent.click(b.getByTestId('cycle-game-start'));
    expect(b.onStart).toHaveBeenCalledTimes(1);
  });

  it('the warning clears when every claimed bike reports', () => {
    const v = view(mk(false, true));
    fireEvent.click(v.getByTestId('cycle-game-start'));
    expect(v.queryByTestId('sensor-warning')).toBeTruthy();
    v.again(mk(true, true));
    expect(v.queryByTestId('sensor-warning')).toBeNull();
    fireEvent.click(v.getByTestId('cycle-game-start'));
    expect(v.onStart).toHaveBeenCalledTimes(1);
  });

  it('the warning clears when the offending bike is unclaimed', () => {
    const v = view(mk(false, true));
    fireEvent.click(v.getByTestId('cycle-game-start'));
    v.again([{ id: 'bike_a', name: 'Bike A', rider: null, sensorLive: false }, mk(false, true)[1]]);
    expect(v.queryByTestId('sensor-warning')).toBeNull();
  });

  it('the warning clears when busy turns true, and its buttons are inert while busy', () => {
    const v = view(mk(false, true));
    fireEvent.click(v.getByTestId('cycle-game-start'));
    v.again(mk(false, true), { busy: true });
    expect(v.queryByTestId('sensor-warning')).toBeNull();
    expect(v.onStart).not.toHaveBeenCalled();
  });

  it('logs the warning and the override', () => {
    const calls = [];
    const spy = vi.spyOn(uiLogMod, 'uiLog').mockReturnValue({
      debug: () => {}, info: (e, d) => calls.push(['info', e, d]), warn: (e, d) => calls.push(['warn', e, d]), error: () => {}
    });
    const v = view(mk(false, true));
    fireEvent.click(v.getByTestId('cycle-game-start'));
    expect(calls).toContainEqual(['warn', 'cycle_game.ui.sensor_warning', { bikes: ['bike_a'] }]);
    fireEvent.click(v.getByTestId('sensor-warning-start'));
    expect(calls.some((c) => c[0] === 'info' && c[1] === 'cycle_game.ui.sensor_warning_override')).toBe(true);
    spy.mockRestore();
  });
});

describe('CycleGameHome — race value stepper', () => {
  const view = (raceType, raceValue, props = {}) => {
    const onSetRaceValue = vi.fn();
    const r = render(
      <CycleGameHome bikes={[]} people={[]} records={[]} raceType={raceType} raceValue={raceValue}
        onSetRaceValue={onSetRaceValue} {...props} />
    );
    return { ...r, onSetRaceValue, inc: () => r.getByLabelText('increase'), dec: () => r.getByLabelText('decrease') };
  };
  const press = (v, which, from) => {
    fireEvent.click(which === '+' ? v.inc() : v.dec());
    return v.onSetRaceValue.mock.calls.at(-1)[0];
  };

  it('+ and - walk the distance grid and reach 100 m and 300 m', () => {
    expect(press(view('distance', 100), '+')).toBe(200); cleanup();
    expect(press(view('distance', 900), '+')).toBe(1000); cleanup();
    expect(press(view('distance', 1000), '+')).toBe(1500); cleanup();
    expect(press(view('distance', 1500), '-')).toBe(1000); cleanup();
    expect(press(view('distance', 1000), '-')).toBe(900); cleanup();
    expect(press(view('time', 300), '+')).toBe(360);
  });

  it('- is disabled at the minimum, + at the maximum, and neither steps', () => {
    let v = view('distance', 100);
    expect(v.dec().disabled).toBe(true);
    fireEvent.click(v.dec());
    expect(v.onSetRaceValue).not.toHaveBeenCalled();
    cleanup();
    v = view('time', 60);
    expect(v.dec().disabled).toBe(true);
    cleanup();
    v = view('distance', 10000);
    expect(v.inc().disabled).toBe(true);
    fireEvent.click(v.inc());
    expect(v.onSetRaceValue).not.toHaveBeenCalled();
    expect(v.getByTestId('cgh-value').textContent).toContain('10 km');
    cleanup();
    v = view('time', 1800);
    expect(v.inc().disabled).toBe(true);
    expect(v.getByTestId('cgh-value').textContent).toContain('30 min');
  });

  it('an off-grid or out-of-range value shows as is and the first press snaps it in', () => {
    let v = view('distance', 20000);
    expect(v.getByTestId('cgh-value').textContent).toContain('20 km');
    expect(press(v, '-')).toBe(10000);
    cleanup();
    v = view('time', 3060);
    expect(press(v, '-')).toBe(1800);
    cleanup();
    v = view('distance', 250);
    expect(press(v, '+')).toBe(300);
  });

  it('the selected preset has aria-pressed true, the others false', () => {
    const v = view('distance', 1000);
    expect(v.getByTestId('tier-short').getAttribute('aria-pressed')).toBe('true');
    expect(v.getByTestId('tier-sprint').getAttribute('aria-pressed')).toBe('false');
    expect(v.getByTestId('tier-long').getAttribute('aria-pressed')).toBe('false');
  });

  it('the stepper buttons are inert when disabled', () => {
    const v = view('distance', 1000, { busy: true });
    expect(v.inc().disabled).toBe(true);
    expect(v.dec().disabled).toBe(true);
  });
});
