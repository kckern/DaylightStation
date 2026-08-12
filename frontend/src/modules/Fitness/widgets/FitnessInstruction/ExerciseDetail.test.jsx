import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import ExerciseDetail, { detailPath } from './ExerciseDetail.jsx';

// ── Logger ───────────────────────────────────────────────────────────────────
const logCalls = vi.hoisted(() => ({ debug: [], info: [], warn: [], error: [] }));
vi.mock('@/lib/logging/Logger.js', () => {
  const makeLogger = (ctx = {}) => {
    const push = (bucket) => (event, data) =>
      logCalls[bucket].push({ component: ctx.component ?? null, event, data });
    return {
      debug: push('debug'),
      info: push('info'),
      warn: push('warn'),
      error: push('error'),
      sampled: push('debug'),
      child: (childCtx = {}) => makeLogger({ ...ctx, ...childCtx })
    };
  };
  const getLogger = () => makeLogger();
  const noop = () => {};
  return {
    default: getLogger,
    getLogger,
    configure: noop,
    resetSamplingState: noop,
    getRecentEvents: () => [],
    getConfig: () => ({}),
    startDiagnostics: noop,
    stopDiagnostics: noop,
    perfSnapshot: () => ({}),
    getStatus: () => ({})
  };
});

// ── Fake API ─────────────────────────────────────────────────────────────────
const RECORDS = {
  'archer-push-up': {
    slug: 'archer-push-up',
    name: 'Archer Push Up',
    description: 'A push up variation that shifts load onto one arm.',
    instructions: [
      'Begin in a high plank position.',
      'Shift your weight onto your left hand.',
      'Lower towards the ground.',
      'Push back up.'
    ],
    image: 'media/library/exercise/assets/archer.gif',
    stills: [
      'media/library/exercise/exercises/archer-push-up_1.png',
      'media/library/exercise/exercises/archer-push-up_2.png'
    ],
    video: null,
    targetMuscles: ['pectorals'],
    groups: ['chest'],
    equipment: ['body-weight']
  },
  // One of the 52 records that carry an MP4.
  'barbell-hack-squat': {
    slug: 'barbell-hack-squat',
    name: 'Barbell Hack Squat',
    description: 'A behind-the-back barbell squat.',
    instructions: ['Stand with the bar behind your calves.', 'Drive through the heels.'],
    image: 'media/library/exercise/assets/hack.gif',
    stills: [],
    video: 'media/library/exercise/hevy_videos/Barbell-Hack-Squat_Hips.mp4',
    targetMuscles: ['quads', 'glutes'],
    groups: ['upper-legs'],
    equipment: ['barbell']
  },
  'no-steps': {
    slug: 'no-steps',
    name: 'No Steps',
    instructions: [],
    image: 'media/library/exercise/assets/nosteps.gif',
    stills: [],
    video: null,
    targetMuscles: [],
    groups: [],
    equipment: []
  }
};

const pending = new Map();
const server = { fail: null, defer: false, requests: [] };

const apiHandler = vi.fn((path) => {
  server.requests.push(path);
  const slug = decodeURIComponent(String(path).split('/').pop());
  const settle = () => {
    if (server.fail) throw new Error(server.fail);
    return { exercise: RECORDS[slug] ?? null };
  };
  if (!server.defer) return Promise.resolve().then(settle);
  return new Promise((resolve, reject) => {
    pending.set(slug, () => {
      try { resolve(settle()); } catch (err) { reject(err); }
    });
  });
});

vi.mock('@/lib/api.mjs', () => ({
  DaylightAPI: (path) => apiHandler(path),
  DaylightAPIText: async () => '',
  DaylightMediaPath: (p) => `https://kiosk.test/${String(p).replace(/^\/|\/$/g, '')}`,
  DaylightImagePath: (k) => `https://kiosk.test/api/v1/static/img/${k}`,
  DaylightStatusCheck: async () => 200,
  DaylightHostPath: () => 'https://kiosk.test',
  ContentDisplayUrl: () => '',
  normalizeImageUrl: (u) => u,
  DaylightWebsocketSubscribe: () => () => {},
  DaylightWebsocketUnsubscribe: () => () => {}
}));

const logsFor = (bucket, event) =>
  logCalls[bucket].filter((l) => l.component === 'exercise-detail' && l.event === event);

beforeEach(() => {
  logCalls.debug.length = 0;
  logCalls.info.length = 0;
  logCalls.warn.length = 0;
  logCalls.error.length = 0;
  server.fail = null;
  server.defer = false;
  server.requests = [];
  pending.clear();
  apiHandler.mockClear();
});

// Waits for the RECORD, not just for the sheet: the name renders during loading
// too (it falls back to the humanised slug), so awaiting it would return while
// the body is still a spinner and make every downstream assertion a race.
async function open(slug, props = {}) {
  const view = render(<ExerciseDetail slug={slug} {...props} />);
  await waitFor(() => expect(view.queryByTestId('exercise-detail-loading')).toBeNull());
  return view;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('detailPath', () => {
  it('targets the per-slug endpoint and escapes the slug', () => {
    expect(detailPath('archer-push-up')).toBe('api/v1/fitness/exercises/archer-push-up');
    expect(detailPath('a/b')).toBe('api/v1/fitness/exercises/a%2Fb');
  });
});

describe('ExerciseDetail — loading the record', () => {
  it('fetches the slug and renders its name', async () => {
    const view = await open('archer-push-up');
    expect(server.requests).toEqual(['api/v1/fitness/exercises/archer-push-up']);
    expect(view.getByTestId('exercise-detail-name').textContent).toBe('Archer Push Up');
  });

  it('shows a loading notice before the record lands', async () => {
    server.defer = true;
    const view = render(<ExerciseDetail slug="archer-push-up" />);
    expect(view.getByTestId('exercise-detail-loading')).toBeTruthy();
    expect(view.queryByTestId('exercise-detail-instructions')).toBeNull();
    // The name falls back to the humanised slug, so the sheet is never blank.
    expect(view.getByTestId('exercise-detail-name').textContent).toBe('Archer Push Up');
  });

  it('reports a failed fetch and logs it at error', async () => {
    server.fail = 'HTTP 500';
    const view = render(<ExerciseDetail slug="archer-push-up" />);
    const notice = await view.findByTestId('exercise-detail-error');
    expect(notice.textContent).toContain('HTTP 500');
    expect(logsFor('error', 'fetch-failed')[0].data).toMatchObject({ slug: 'archer-push-up', error: 'HTTP 500' });
  });

  it('handles a slug the library no longer has', async () => {
    const view = render(<ExerciseDetail slug="ghost-exercise" />);
    await view.findByTestId('exercise-detail-missing');
    expect(view.queryByTestId('exercise-detail-error')).toBeNull();
  });

  it('drops a response for a slug the user already navigated away from', async () => {
    server.defer = true;
    const view = render(<ExerciseDetail slug="archer-push-up" />);
    view.rerender(<ExerciseDetail slug="barbell-hack-squat" />);

    // Second request resolves first, then the abandoned first one lands.
    pending.get('barbell-hack-squat')();
    await view.findByTestId('exercise-detail-instructions');
    pending.get('archer-push-up')();

    await waitFor(() => expect(logsFor('debug', 'fetch-dropped-stale')).toHaveLength(1));
    expect(view.getByTestId('exercise-detail-name').textContent).toBe('Barbell Hack Squat');
    expect(view.getByTestId('exercise-detail-instructions').children).toHaveLength(2);
  });
});

describe('ExerciseDetail — instructions', () => {
  it('renders every instruction as an ordered step, in order', async () => {
    const view = await open('archer-push-up');
    const list = view.getByTestId('exercise-detail-instructions');
    expect(list.tagName).toBe('OL');
    expect(Array.from(list.children).map((li) => li.textContent)).toEqual([
      'Begin in a high plank position.',
      'Shift your weight onto your left hand.',
      'Lower towards the ground.',
      'Push back up.'
    ]);
  });

  it('says so when a record has no written steps', async () => {
    const view = await open('no-steps');
    expect(view.queryByTestId('exercise-detail-instructions')).toBeNull();
    expect(view.getByTestId('exercise-detail-no-instructions').textContent).toContain('follow the animation');
  });
});

describe('ExerciseDetail — media', () => {
  it('shows the GIF through DaylightMediaPath, with no video toggle when there is no MP4', async () => {
    const view = await open('archer-push-up');
    expect(view.getByTestId('exercise-detail-gif').getAttribute('src'))
      .toBe('https://kiosk.test/media/library/exercise/assets/archer.gif');
    // 1,244 of 1,296 records land here. It is the normal case, so nothing on
    // screen may present it as a missing-video failure.
    expect(view.queryByTestId('exercise-detail-video-toggle')).toBeNull();
    expect(view.container.textContent.toLowerCase()).not.toContain('no video');
    expect(view.container.textContent.toLowerCase()).not.toContain('unavailable');
  });

  it('renders the stills strip when the record has stills', async () => {
    const view = await open('archer-push-up');
    const stills = view.getByTestId('exercise-detail-stills');
    expect(Array.from(stills.querySelectorAll('img')).map((i) => i.getAttribute('src'))).toEqual([
      'https://kiosk.test/media/library/exercise/exercises/archer-push-up_1.png',
      'https://kiosk.test/media/library/exercise/exercises/archer-push-up_2.png'
    ]);
  });

  it('offers the MP4 for the records that have one, and defaults to the GIF', async () => {
    const view = await open('barbell-hack-squat');
    // Default is still the GIF: the MP4 is opt-in, not autoplayed on open.
    expect(view.getByTestId('exercise-detail-gif')).toBeTruthy();
    expect(view.queryByTestId('exercise-detail-video')).toBeNull();

    fireEvent.pointerDown(view.getByTestId('exercise-detail-video-toggle'));
    const video = view.getByTestId('exercise-detail-video');
    expect(video.tagName).toBe('VIDEO');
    expect(video.getAttribute('src'))
      .toBe('https://kiosk.test/media/library/exercise/hevy_videos/Barbell-Hack-Squat_Hips.mp4');
    expect(view.queryByTestId('exercise-detail-gif')).toBeNull();
    expect(logsFor('info', 'video-toggle')[0].data).toEqual({ slug: 'barbell-hack-squat', to: true });

    fireEvent.pointerDown(view.getByTestId('exercise-detail-video-toggle'));
    expect(view.queryByTestId('exercise-detail-video')).toBeNull();
    expect(view.getByTestId('exercise-detail-gif')).toBeTruthy();
    expect(logsFor('info', 'video-toggle')[1].data).toEqual({ slug: 'barbell-hack-squat', to: false });
  });
});

describe('ExerciseDetail — chips push back into the filter', () => {
  it('reports the facet and the value for a group, muscle and equipment chip', async () => {
    const onFilter = vi.fn();
    const view = await open('barbell-hack-squat', { onFilter });

    fireEvent.pointerDown(view.getByTestId('exercise-detail-group-upper-legs'));
    fireEvent.pointerDown(view.getByTestId('exercise-detail-muscle-glutes'));
    fireEvent.pointerDown(view.getByTestId('exercise-detail-equipment-barbell'));

    expect(onFilter.mock.calls).toEqual([
      ['groups', 'upper-legs'],
      ['muscles', 'glutes'],
      ['equipment', 'barbell']
    ]);
  });

  it('labels chips from the slug', async () => {
    const view = await open('barbell-hack-squat', { onFilter: vi.fn() });
    expect(view.getByTestId('exercise-detail-group-upper-legs').textContent).toBe('Upper Legs');
    expect(view.getByTestId('exercise-detail-equipment-barbell').textContent).toBe('Barbell');
  });
});

describe('ExerciseDetail — tray and dismissal', () => {
  it('hands the full record to onAdd', async () => {
    const onAdd = vi.fn();
    const view = await open('archer-push-up', { onAdd });
    fireEvent.pointerDown(view.getByTestId('exercise-detail-add'));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].slug).toBe('archer-push-up');
    expect(onAdd.mock.calls[0][0].instructions).toHaveLength(4);
  });

  it('flips the add target to a remove when the exercise is already in the tray', async () => {
    const view = await open('archer-push-up', { inTray: true });
    expect(view.getByTestId('exercise-detail-add').textContent).toBe('Remove from workout');
  });

  it('closes on the close target', async () => {
    const onClose = vi.fn();
    const view = await open('archer-push-up', { onClose });
    fireEvent.pointerDown(view.getByTestId('exercise-detail-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    await open('archer-push-up', { onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stops listening for Escape once unmounted', async () => {
    const onClose = vi.fn();
    const view = await open('archer-push-up', { onClose });
    view.unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('ExerciseDetail — touch conventions', () => {
  it('does not activate on a bare click (onPointerDown, not onClick)', async () => {
    const onClose = vi.fn();
    const onFilter = vi.fn();
    const view = await open('barbell-hack-squat', { onClose, onFilter });
    fireEvent.click(view.getByTestId('exercise-detail-close'));
    fireEvent.click(view.getByTestId('exercise-detail-equipment-barbell'));
    expect(onClose).not.toHaveBeenCalled();
    expect(onFilter).not.toHaveBeenCalled();
  });

  it('activates on Enter and Space', async () => {
    const onClose = vi.fn();
    const onFilter = vi.fn();
    const view = await open('barbell-hack-squat', { onClose, onFilter });
    fireEvent.keyDown(view.getByTestId('exercise-detail-equipment-barbell'), { key: 'Enter' });
    fireEvent.keyDown(view.getByTestId('exercise-detail-close'), { key: ' ' });
    expect(onFilter).toHaveBeenCalledWith('equipment', 'barbell');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
