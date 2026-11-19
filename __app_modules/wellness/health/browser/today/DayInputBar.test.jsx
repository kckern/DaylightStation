import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
const warnings = vi.hoisted(() => []);
vi.mock('../../../../../frontend/src/lib/ui/createAppLogger.js', async importOriginal => {
  const actual = await importOriginal();
  const watch = logger => new Proxy(logger, { get(target, key) {
    if (key === 'warn') return (event, data) => { warnings.push([event, data]); return target.warn(event, data); };
    if (key === 'child') return (...args) => watch(target.child(...args));
    const value = target[key];
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  return { ...actual, createAppLogger: (...args) => watch(actual.createAppLogger(...args)) };
});
vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: (...args) => apiMock(...args) }));
vi.mock('../capture/VoiceCapture.jsx', () => ({ VoiceCapture: ({ onCapture, labelPrefix, onError, className }) => <>
  <button type="button" className={className} onClick={() => onCapture('data:audio')}>{labelPrefix}</button>
  <button type="button" onClick={() => onError('Microphone unavailable.')}>Break the microphone</button>
</> }));
import { DayInputBar, dayBarFallback } from './DayInputBar.jsx';
import { MoveResult } from './mealDrag.jsx';
import { MoveDayControl } from './MoveDayControl.jsx';
import { LogTable } from './LogTable.jsx';
import { HealthOperationsProvider, useHealthOperations } from '../operations/HealthOperationsProvider.jsx';

const date = '2026-11-18', yesterday = '2026-11-17';
const entries = [{ uuid: 'eggs', name: 'Eggs', date, mealTime: 'morning' }, { uuid: 'tea', name: 'Tea', date, mealTime: 'afternoon' }, { uuid: 'loose', name: 'Loose', date, mealTime: null }];
const FIELD = 'Log food or change this day';
const field = () => screen.getByRole('textbox', { name: FIELD });
const ui = props => <MantineProvider><DayInputBar date={date} today={date} entries={entries} {...props} /></MantineProvider>;
const setup = (props = {}) => {
  const onResult = vi.fn(), onMoveDay = vi.fn(async () => MoveResult.MOVED);
  const all = { onResult, onMoveDay, ...props };
  const view = render(ui(all));
  return { onResult, onMoveDay: all.onMoveDay, rerender: next => view.rerender(ui({ ...all, ...next })) };
};
const type = text => {
  fireEvent.change(field(), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
};
const speak = () => fireEvent.click(screen.getByRole('button', { name: 'Speak foods or changes' }));
const body = index => apiMock.mock.calls[index][1];
const httpError = (status, data) => Object.assign(new Error(`HTTP ${status}: nope`), { status, body: data });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const whichFood = extra => ({ committed: false, outcome: 'clarification', clarification: { kind: 'food', question: 'Which food did you mean?', choices: [{ id: 'tea', label: 'Tea' }] }, ...extra });
const whichDay = extra => ({ committed: false, outcome: 'clarification', clarification: { kind: 'day', question: 'Which day should this go to?', choices: [] }, ...extra });
const done = { committed: true, outcome: 'committed', kind: 'moved', message: 'Moved Tea' };

// A touch screen: (pointer: coarse) matches, as on a phone.
const asTouchScreen = () => {
  const original = window.matchMedia;
  window.matchMedia = query => ({ matches: /pointer:\s*coarse/.test(query), media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
  return () => { window.matchMedia = original; };
};
beforeEach(() => { apiMock.mockReset(); warnings.length = 0; });
afterEach(cleanup);

describe('DayInputBar', () => {
  it('sends typed words for the viewed day and reports the result', async () => {
    apiMock.mockResolvedValue({ committed: true, outcome: 'committed', kind: 'moved', message: 'Moved Tea to Snacks', undoToken: 'meal-1' });
    const { onResult } = setup();
    type('move the tea to snacks');
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ undoToken: 'meal-1' }), { date }));
    expect(apiMock.mock.calls[0]).toEqual(['api/v1/health/nutrition/day-input', expect.objectContaining({ type: 'text', content: 'move the tea to snacks', date }), 'POST']);
    expect(body(0).operationId).toBeTruthy();
    expect(field().value).toBe('');
  });
  it('sends a recording as voice', async () => {
    apiMock.mockResolvedValue({ committed: true, outcome: 'committed' });
    setup();
    speak();
    await waitFor(() => expect(body(0)).toMatchObject({ type: 'voice', content: 'data:audio', date }));
    expect(body(0)).not.toHaveProperty('audioRef');
  });
  it('asks which food and resubmits the same words with the answer, as a new operation', async () => {
    apiMock.mockResolvedValueOnce(whichFood({ instructionText: 'move it' })).mockResolvedValueOnce(done);
    const { onResult } = setup();
    type('move it');
    fireEvent.click(await screen.findByRole('button', { name: 'Tea' }));
    await waitFor(() => expect(body(1)).toMatchObject({ type: 'text', content: 'move it', resolved: { foodId: 'tea' } }));
    expect(body(1).operationId).not.toBe(body(0).operationId);
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Which food did you mean?')).toBeNull();
  });
  it('asks for a day with a date field', async () => {
    apiMock.mockResolvedValueOnce(whichDay({ instructionText: 'last month' })).mockResolvedValueOnce({ committed: true, outcome: 'committed' });
    setup();
    type('last month');
    fireEvent.change(await screen.findByLabelText('Which day should this go to?'), { target: { value: '2026-10-02' } });
    await waitFor(() => expect(body(1).resolved).toEqual({ toDate: '2026-10-02' }));
  });
  it('ignores a half-typed year in the date field', async () => {
    apiMock.mockResolvedValueOnce(whichDay({ instructionText: 'last month' }));
    setup();
    type('last month');
    fireEvent.change(await screen.findByLabelText('Which day should this go to?'), { target: { value: '0002-10-02' } });
    expect(apiMock).toHaveBeenCalledTimes(1);
  });
  it('keeps every earlier answer when a second question follows', async () => {
    apiMock.mockResolvedValueOnce(whichFood({ instructionText: 'move it' })).mockResolvedValueOnce(whichDay({ instructionText: 'move it' })).mockResolvedValueOnce(done);
    setup();
    type('move it');
    fireEvent.click(await screen.findByRole('button', { name: 'Tea' }));
    fireEvent.change(await screen.findByLabelText('Which day should this go to?'), { target: { value: '2026-10-02' } });
    await waitFor(() => expect(body(2).resolved).toEqual({ foodId: 'tea', toDate: '2026-10-02' }));
  });
  describe('a day question that names its foods', () => {
    const named = extra => { const reply = whichDay({ instructionText: 'move the tea', ...extra }); return { ...reply, clarification: { ...reply.clarification, foodIds: ['tea'], fromDate: yesterday } }; };
    it('sends those foods and their day back with the answer', async () => {
      apiMock.mockResolvedValueOnce(named()).mockResolvedValueOnce(done);
      setup();
      type('move the tea');
      fireEvent.change(await screen.findByLabelText('Which day should this go to?'), { target: { value: '2026-10-02' } });
      await waitFor(() => expect(body(1).resolved).toEqual({ toDate: '2026-10-02', foodIds: ['tea'], fromDate: yesterday }));
      expect(body(1).content).toBe('move the tea');
    });
    it('they replace a food already chosen, which they include', async () => {
      apiMock.mockResolvedValueOnce(whichFood({ instructionText: 'move it' })).mockResolvedValueOnce(named()).mockResolvedValueOnce(done);
      setup();
      type('move it');
      fireEvent.click(await screen.findByRole('button', { name: 'Tea' }));
      fireEvent.change(await screen.findByLabelText('Which day should this go to?'), { target: { value: '2026-10-02' } });
      await waitFor(() => expect(body(2).resolved).toEqual({ toDate: '2026-10-02', foodIds: ['tea'], fromDate: yesterday }));
    });
    it('a failed answer retries with the same foods and operation', async () => {
      apiMock.mockResolvedValueOnce(named()).mockRejectedValueOnce(httpError(500, {})).mockResolvedValueOnce(done);
      setup();
      type('move the tea');
      fireEvent.change(await screen.findByLabelText('Which day should this go to?'), { target: { value: '2026-10-02' } });
      fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(3));
      expect(body(2)).toEqual(body(1));
    });
  });
  it('uses the words it sent when a reply leaves them out', async () => {
    apiMock.mockResolvedValueOnce(whichFood()).mockResolvedValueOnce(done);
    setup();
    type('move it');
    fireEvent.click(await screen.findByRole('button', { name: 'Tea' }));
    await waitFor(() => expect(body(1)).toMatchObject({ type: 'text', content: 'move it' }));
  });
  it('answers a spoken question from the words the server heard', async () => {
    apiMock.mockResolvedValueOnce(whichFood({ instructionText: 'move that one' })).mockResolvedValueOnce(done);
    setup();
    speak();
    fireEvent.click(await screen.findByRole('button', { name: 'Tea' }));
    await waitFor(() => expect(body(1)).toMatchObject({ type: 'text', content: 'move that one', resolved: { foodId: 'tea' } }));
  });
  it('answers a spoken question from the recording when no words came back', async () => {
    apiMock.mockResolvedValueOnce(whichFood()).mockResolvedValueOnce(done);
    setup();
    speak();
    fireEvent.click(await screen.findByRole('button', { name: 'Tea' }));
    await waitFor(() => expect(body(1)).toMatchObject({ type: 'voice', content: 'data:audio', resolved: { foodId: 'tea' } }));
    expect(body(1).operationId).not.toBe(body(0).operationId);
  });
  it('keeps the question and its answer with the day it was asked on', async () => {
    apiMock.mockResolvedValueOnce(whichFood({ instructionText: 'move it' })).mockResolvedValueOnce(done);
    const { onResult, rerender } = setup({ date: yesterday });
    type('move it');
    await screen.findByRole('button', { name: 'Tea' });
    rerender({ date });
    expect(screen.getByText(/Yesterday/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tea' }));
    await waitFor(() => expect(body(1)).toMatchObject({ date: yesterday, resolved: { foodId: 'tea' } }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(expect.anything(), { date: yesterday }));
  });
  it('a request in flight stays with its day when the view changes', async () => {
    const reply = deferred();
    apiMock.mockReturnValueOnce(reply.promise).mockResolvedValueOnce(done);
    const { rerender } = setup({ date: yesterday });
    type('move it');
    rerender({ date });
    await act(async () => { reply.resolve(whichFood({ instructionText: 'move it' })); });
    fireEvent.click(await screen.findByRole('button', { name: 'Tea' }));
    await waitFor(() => expect(body(1).date).toBe(yesterday));
  });
  it('Cancel drops the question and leaves the words to edit', async () => {
    apiMock.mockResolvedValueOnce(whichFood({ instructionText: 'move it' }));
    setup();
    type('move it');
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Tea' })).toBeNull();
    expect(field().value).toBe('move it');
  });
  it('hands over a reply that changed nothing and keeps the words', async () => {
    apiMock.mockResolvedValue({ committed: false, outcome: 'no-change', message: 'Please make one change at a time.' });
    const { onResult } = setup();
    type('move this and that');
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'no-change' }), { date }));
    expect(field().value).toBe('move this and that');
  });
  it('keeps the words and shows the error when sending fails', async () => {
    apiMock.mockRejectedValue(new Error('Day input is unavailable right now'));
    setup();
    type('eggs');
    expect((await screen.findByRole('alert')).textContent).toMatch(/unavailable/);
    expect(field().value).toBe('eggs');
  });
  it('shows feedback over the page instead of in its flow', async () => {
    apiMock.mockRejectedValue(new Error('Day input is unavailable right now'));
    setup();
    type('eggs');
    expect((await screen.findByRole('alert')).closest('.health-day-input__overlay')).toBeTruthy();
  });
  it('shows a microphone problem in the same place', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Break the microphone' }));
    expect((await screen.findByRole('alert')).closest('.health-day-input__overlay')).toBeTruthy();
  });
  it('shows the server sentence for text that is too long and offers no pointless retry', async () => {
    apiMock.mockRejectedValue(httpError(400, { error: 'That is too long to log at once.', code: 'DAY_INPUT_TOO_LONG' }));
    setup();
    type('eggs');
    expect((await screen.findByRole('alert')).textContent).toContain('That is too long to log at once.');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
  it('retries an unknown outcome with the same operation, from the button or from Send', async () => {
    apiMock.mockRejectedValueOnce(new Error('Network error: down')).mockRejectedValueOnce(new Error('Network error: down')).mockResolvedValueOnce(done);
    const { onResult } = setup();
    type('eggs');
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    await screen.findByRole('button', { name: 'Try again' });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onResult).toHaveBeenCalled());
    expect(new Set(apiMock.mock.calls.map(call => call[1].operationId)).size).toBe(1);
  });
  it('edited words are a new request', async () => {
    apiMock.mockRejectedValueOnce(new Error('Network error: down')).mockResolvedValueOnce(done);
    setup();
    type('eggs');
    await screen.findByRole('button', { name: 'Try again' });
    type('two eggs');
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    expect(body(1).operationId).not.toBe(body(0).operationId);
  });
  it('the same words after a success are a new request', async () => {
    apiMock.mockResolvedValue(done);
    const { onResult } = setup();
    type('eggs');
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    type('eggs');
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(2));
    expect(body(1).operationId).not.toBe(body(0).operationId);
  });
  it('a failed recording retries from its saved copy under the same operation', async () => {
    apiMock.mockRejectedValueOnce(httpError(502, { error: 'Could not hear that.', code: 'TRANSCRIBE_FAILED', audioRef: 'va_123' })).mockResolvedValueOnce(done);
    setup();
    speak();
    expect((await screen.findByRole('alert')).textContent).toContain('Could not hear that.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    expect(body(1)).toMatchObject({ type: 'voice', audioRef: 'va_123', operationId: body(0).operationId });
    expect(body(1)).not.toHaveProperty('content');
  });
  it('a recording that was too long is not retried', async () => {
    apiMock.mockRejectedValueOnce(httpError(422, { error: 'Too long.', code: 'DAY_INPUT_TOO_LONG', audioRef: 'va_123' }));
    setup();
    speak();
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
  it('blocks a second send while one is running and says it is working', async () => {
    const reply = deferred();
    apiMock.mockReturnValue(reply.promise);
    const { onResult } = setup();
    type('eggs');
    const form = field().closest('form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(field().readOnly).toBe(true);
    expect(screen.getByRole('status').textContent).toMatch(/Working/);
    await act(async () => { reply.resolve(done); });
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(field().readOnly).toBe(false);
  });
  it('a recording that ends during a send goes next, and is not lost', async () => {
    const reply = deferred();
    apiMock.mockReturnValueOnce(reply.promise).mockResolvedValueOnce(done);
    setup();
    type('eggs');
    speak();
    expect(apiMock).toHaveBeenCalledTimes(1);
    await act(async () => { reply.resolve(done); });
    await waitFor(() => expect(body(1)).toMatchObject({ type: 'voice', content: 'data:audio' }));
  });
  it('keeps focus on the field after a send', async () => {
    apiMock.mockResolvedValue(done);
    const { onResult } = setup();
    field().focus();
    type('eggs');
    await waitFor(() => expect(onResult).toHaveBeenCalled());
    expect(document.activeElement).toBe(field());
  });
  it('returns focus from the Send button, but not from somewhere else on the page', async () => {
    apiMock.mockResolvedValue(done);
    const { onResult } = setup();
    screen.getByRole('button', { name: 'Send' }).focus();
    type('eggs');
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(document.activeElement).toBe(field());
    const elsewhere = document.body.appendChild(document.createElement('button'));
    elsewhere.focus();
    type('tea');
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(2));
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });
});

describe('a recording made while something is unsettled', () => {
  const voiceSends = () => apiMock.mock.calls.filter(call => call[1].type === 'voice');
  it('waits behind a question the running request raises, and goes after the answer', async () => {
    const reply = deferred();
    apiMock.mockReturnValueOnce(reply.promise).mockResolvedValue(done);
    setup();
    type('move it');
    speak();
    await act(async () => { reply.resolve(whichFood({ instructionText: 'move it' })); });
    expect(await screen.findByRole('button', { name: 'Tea' })).toBeTruthy();
    expect(screen.getByText(/recording is waiting/i, { selector: '.health-day-input__waiting' })).toBeTruthy();
    expect(voiceSends()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Tea' }));
    await waitFor(() => expect(voiceSends()).toHaveLength(1));
    expect(body(1)).toMatchObject({ type: 'text', resolved: { foodId: 'tea' } });
    expect(body(2)).toMatchObject({ type: 'voice', content: 'data:audio' });
  });
  it('says it is waiting while a request runs, on screen and in the status region', async () => {
    const reply = deferred();
    apiMock.mockReturnValueOnce(reply.promise).mockResolvedValue(done);
    setup();
    type('eggs');
    speak();
    const line = await screen.findByText(/recording is waiting/i, { selector: '.health-day-input__waiting' });
    expect(line.closest('.health-day-input__overlay')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/Working.*recording is waiting/);
    await act(async () => { reply.resolve(done); });
    await waitFor(() => expect(voiceSends()).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText(/recording is waiting/i)).toBeNull());
  });
  it('logs only the count when the bar goes away with recordings queued', async () => {
    apiMock.mockReturnValue(new Promise(() => {}));
    const view = render(ui({ onResult: vi.fn(), onMoveDay: vi.fn() }));
    type('eggs');
    speak();
    speak();
    await screen.findByText(/2 recordings are waiting/i, { selector: '.health-day-input__waiting' });
    view.unmount();
    expect(warnings).toContainEqual(['day-input.recording-dropped', { count: 2 }]);
  });
  it('logs nothing when the bar goes away with nothing queued', () => {
    const view = render(ui({ onResult: vi.fn(), onMoveDay: vi.fn() }));
    view.unmount();
    expect(warnings.filter(([event]) => event === 'day-input.recording-dropped')).toHaveLength(0);
  });
  it('is not sent over an open question until it is cancelled', async () => {
    apiMock.mockResolvedValueOnce(whichFood({ instructionText: 'move it' })).mockResolvedValue(done);
    setup();
    type('move it');
    await screen.findByRole('button', { name: 'Tea' });
    speak();
    await act(async () => {});
    expect(voiceSends()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Tea' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(voiceSends()).toHaveLength(1));
  });
  it('waits behind a failure, which stays readable, until it is dismissed', async () => {
    const reply = deferred();
    apiMock.mockReturnValueOnce(reply.promise).mockResolvedValue(done);
    setup();
    type('eggs');
    speak();
    await act(async () => { reply.reject(new Error('Network error: down')); });
    expect((await screen.findByRole('alert')).textContent).toMatch(/did not go through/);
    expect(voiceSends()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(voiceSends()).toHaveLength(1));
  });
  it('waits while a retry runs, and goes once it succeeds', async () => {
    apiMock.mockRejectedValueOnce(new Error('Network error: down')).mockResolvedValue(done);
    setup();
    type('eggs');
    await screen.findByRole('button', { name: 'Try again' });
    speak();
    await act(async () => {});
    expect(voiceSends()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(voiceSends()).toHaveLength(1));
    expect(body(1).operationId).toBe(body(0).operationId);
  });
});

describe('questions and focus', () => {
  it('announces a question and takes focus to its first choice', async () => {
    apiMock.mockResolvedValueOnce(whichFood({ instructionText: 'move it' }));
    setup();
    field().focus();
    type('move it');
    const tea = await screen.findByRole('button', { name: 'Tea' });
    expect(screen.getByRole('status').textContent).toBe('Which food did you mean?');
    await waitFor(() => expect(document.activeElement).toBe(tea));
  });
  it('takes focus to the date field for a day question', async () => {
    apiMock.mockResolvedValueOnce(whichDay({ instructionText: 'last month' }));
    setup();
    field().focus();
    type('last month');
    const input = await screen.findByLabelText('Which day should this go to?');
    await waitFor(() => expect(document.activeElement).toBe(input));
  });
  it('leaves focus alone when the person has moved elsewhere', async () => {
    apiMock.mockResolvedValueOnce(whichFood({ instructionText: 'move it' }));
    setup();
    const elsewhere = document.body.appendChild(document.createElement('button'));
    type('move it');
    elsewhere.focus();
    await screen.findByRole('button', { name: 'Tea' });
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });
  describe('when the control that had focus is gone at the end of a request', () => {
    const answerTea = async () => {
      setup();
      field().focus();
      type('move it');
      const tea = await screen.findByRole('button', { name: 'Tea' });
      await waitFor(() => expect(document.activeElement).toBe(tea));
      fireEvent.click(tea);
    };
    it('a failed answer puts focus on Try again', async () => {
      apiMock.mockResolvedValueOnce(whichFood({ instructionText: 'move it' })).mockRejectedValueOnce(httpError(500, { error: 'Could not process that.' }));
      await answerTea();
      const retry = await screen.findByRole('button', { name: 'Try again' });
      await waitFor(() => expect(document.activeElement).toBe(retry));
    });
    it('a Try again that fails again puts focus on the new Try again', async () => {
      apiMock.mockResolvedValueOnce(whichFood({ instructionText: 'move it' })).mockRejectedValue(httpError(500, { error: 'Could not process that.' }));
      await answerTea();
      fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(3));
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' })));
    });
    it('a refused answer puts focus on Dismiss, the only action left', async () => {
      apiMock.mockResolvedValueOnce(whichFood({ instructionText: 'move it' })).mockRejectedValueOnce(httpError(422, { error: 'Those foods are gone.' }));
      await answerTea();
      const dismiss = await screen.findByRole('button', { name: 'Dismiss' });
      await waitFor(() => expect(document.activeElement).toBe(dismiss));
    });
    it('a question that follows an answer takes focus at its first choice', async () => {
      apiMock.mockResolvedValueOnce(whichFood({ instructionText: 'move it' })).mockResolvedValueOnce(whichFood({ instructionText: 'move it' }));
      await answerTea();
      await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Tea' })));
    });
    it('a finished recording returns focus to the microphone', async () => {
      apiMock.mockResolvedValueOnce({ committed: true, outcome: 'committed' });
      const { onResult } = setup();
      speak();
      await waitFor(() => expect(onResult).toHaveBeenCalled());
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Speak foods or changes' })));
    });
    it('a press elsewhere during the request keeps focus from being pulled back', async () => {
      const reply = deferred();
      apiMock.mockReturnValueOnce(reply.promise);
      setup();
      speak();
      await waitFor(() => expect(apiMock).toHaveBeenCalled());
      fireEvent.pointerDown(document.body);
      await act(async () => { reply.reject(httpError(500, { error: 'Could not process that.' })); });
      await screen.findByRole('button', { name: 'Try again' });
      expect(document.activeElement).toBe(document.body);
    });
    it('focus still on the field stays there after a failure, so the words can be edited', async () => {
      apiMock.mockRejectedValueOnce(httpError(500, { error: 'Could not process that.' }));
      setup();
      field().focus();
      type('eggs');
      await screen.findByRole('button', { name: 'Try again' });
      expect(document.activeElement).toBe(field());
    });
  });
  it('Cancel returns to the field', async () => {
    apiMock.mockResolvedValueOnce(whichFood({ instructionText: 'move it' }));
    setup();
    type('move it');
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(field());
  });
});

describe('DayInputBar in a Health session', () => {
  const session = { current: null };
  const Probe = () => { session.current = useHealthOperations(); return null; };
  const open = send => render(<MantineProvider><HealthOperationsProvider userId="u" send={send}><Probe />
    <DayInputBar date={date} today={date} entries={entries} onResult={vi.fn()} onMoveDay={vi.fn()} /></HealthOperationsProvider></MantineProvider>);

  it('sends a saved recording under the same ID, which a changed body would otherwise block', async () => {
    const send = vi.fn().mockRejectedValueOnce(httpError(502, { error: 'Could not hear that.', audioRef: 'va_123' }))
      .mockResolvedValue({ committed: false, outcome: 'no-food', message: 'No food.' });
    open(send);
    speak();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1][1]).toMatchObject({ audioRef: 'va_123', operationId: send.mock.calls[0][1].operationId });
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('retries an unknown outcome through the session', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('Network error: down')).mockResolvedValue({ committed: false, outcome: 'no-food', message: 'No food.' });
    open(send);
    type('eggs');
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1][1].operationId).toBe(send.mock.calls[0][1].operationId);
  });
  it('reports a failure once: not again in the Ungrouped section', async () => {
    const byBucket = new Map([[null, [{ uuid: 'loose', name: 'Loose', date, mealTime: null }]]]);
    render(<MantineProvider><HealthOperationsProvider userId="u" send={vi.fn().mockRejectedValue(new Error('Network error: down'))}>
      <DayInputBar date={date} today={date} entries={entries} onResult={vi.fn()} onMoveDay={vi.fn()} />
      <LogTable date={date} byBucket={byBucket} onRowTap={() => {}} onMealChanged={() => {}} />
    </HealthOperationsProvider></MantineProvider>);
    type('eggs');
    await screen.findByRole('button', { name: 'Try again' });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
  it('falls back to the upload under the same ID when the saved recording is gone', async () => {
    const send = vi.fn().mockRejectedValueOnce(httpError(502, { error: 'Could not hear that.', audioRef: 'va_123' }))
      .mockRejectedValueOnce(httpError(404, { error: 'That recording is no longer available.', code: 'AUDIO_NOT_FOUND' }))
      .mockResolvedValue({ committed: false, outcome: 'no-food', message: 'No food.' });
    open(send);
    speak();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    expect(send.mock.calls[1][1]).toMatchObject({ audioRef: 'va_123' });
    expect(send.mock.calls[1][1]).not.toHaveProperty('content');
    expect(send.mock.calls[2][1]).toMatchObject({ type: 'voice', content: 'data:audio', operationId: send.mock.calls[0][1].operationId });
    expect(send.mock.calls[2][1]).not.toHaveProperty('audioRef');
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
  it('a refused request does not stay in the session', async () => {
    open(vi.fn().mockRejectedValue(httpError(422, { error: 'No.', code: 'INVALID_DAY_INSTRUCTION' })));
    type('eggs');
    await screen.findByRole('alert');
    expect(session.current.store.getSnapshot().operations.size).toBe(0);
  });
});

describe("Move this day's food", () => {
  const MOVE = "Move this day's food";
  const openSheet = async () => { fireEvent.click(screen.getByRole('button', { name: MOVE })); await screen.findByRole('checkbox', { name: 'Tea' }); };
  const moveTo = async () => {
    fireEvent.click(screen.getByRole('button', { name: /^Move \d+ selected to another day$/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Yesterday' }));
  };

  it('moves only the foods left ticked, and closes once they moved', async () => {
    const { onMoveDay } = setup();
    await openSheet();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tea' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Loose' }));
    expect(screen.getByRole('button', { name: 'Move 1 selected to another day' })).toBeTruthy();
    await moveTo();
    await waitFor(() => expect(onMoveDay).toHaveBeenCalledWith([expect.objectContaining({ uuid: 'eggs' })], yesterday, expect.any(Object)));
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Eggs' })).toBeNull());
  });
  it('stays open with the unticks after a failed move', async () => {
    const { onMoveDay } = setup({ onMoveDay: vi.fn(async () => MoveResult.NOT_MOVED) });
    await openSheet();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tea' }));
    await moveTo();
    await waitFor(() => expect(onMoveDay).toHaveBeenCalled());
    expect(await screen.findByText(/not moved/i)).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Tea' }).checked).toBe(false);
    expect(screen.getByRole('checkbox', { name: 'Eggs' }).checked).toBe(true);
  });
  it('says why when the foods are already there', async () => {
    setup({ onMoveDay: vi.fn(async () => MoveResult.UNCHANGED) });
    await openSheet();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tea' }));
    await moveTo();
    expect(await screen.findByText('Those foods are already on Yesterday.')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Tea' }).checked).toBe(false);
  });
  it('offers no move once nothing is ticked', async () => {
    setup();
    await openSheet();
    for (const name of ['Eggs', 'Tea', 'Loose']) fireEvent.click(screen.getByRole('checkbox', { name }));
    expect(screen.queryByRole('button', { name: /selected to another day/ })).toBeNull();
  });
  it('shows a definite refusal with its reason', async () => {
    setup({ onMoveDay: vi.fn(async (_rows, _iso, { onRefused }) => { onRefused('This entry changed. Reload before saving.'); return MoveResult.NOT_MOVED; }) });
    await openSheet();
    await moveTo();
    expect(await screen.findByText('This entry changed. Reload before saving.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
  it('holds the choices while an unknown move can be retried', async () => {
    const retry = vi.fn(async () => MoveResult.UNKNOWN);
    setup({ onMoveDay: vi.fn(async (_rows, _iso, { onRetryable }) => { onRetryable(retry); return MoveResult.UNKNOWN; }) });
    await openSheet();
    await moveTo();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('checkbox', { name: 'Tea' }).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /selected to another day/ })).toBeNull();
  });
  it('tells the page which move it is holding, until it closes', async () => {
    const onClaimMove = vi.fn(), run = Object.assign(vi.fn(async () => MoveResult.UNKNOWN), { operationId: 'op-1' });
    setup({ onClaimMove, onMoveDay: vi.fn(async (_rows, _iso, { onRetryable }) => { onRetryable(run); return MoveResult.UNKNOWN; }) });
    await openSheet();
    await moveTo();
    const retry = await screen.findByRole('button', { name: 'Try again' });
    await waitFor(() => expect(document.activeElement).toBe(retry));
    expect(onClaimMove).toHaveBeenLastCalledWith('op-1');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(onClaimMove).toHaveBeenLastCalledWith(null));
  });
  it('a refusal takes focus to its note when the picked control left with it', async () => {
    setup({ onMoveDay: vi.fn(async (_rows, _iso, { onRefused }) => { onRefused("Can't move these yet."); return MoveResult.NOT_MOVED; }) });
    await openSheet();
    await moveTo();
    const note = await screen.findByText("Can't move these yet.");
    await waitFor(() => expect(document.activeElement).toBe(note));
  });
  it('tells the page when it closes on a move still to be finished', async () => {
    const onMoveHandedBack = vi.fn(), run = Object.assign(vi.fn(async () => MoveResult.UNKNOWN), { operationId: 'op-1' });
    setup({ onMoveHandedBack, onMoveDay: vi.fn(async (_rows, _iso, { onRetryable }) => { onRetryable(run); return MoveResult.UNKNOWN; }) });
    await openSheet();
    await moveTo();
    await screen.findByRole('button', { name: 'Try again' });
    expect(onMoveHandedBack).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(onMoveHandedBack).toHaveBeenCalledWith('op-1'));
  });
  it('a sheet closed with nothing to finish hands nothing back', async () => {
    const onMoveHandedBack = vi.fn();
    setup({ onMoveHandedBack });
    await openSheet();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Tea' })).toBeNull());
    expect(onMoveHandedBack).not.toHaveBeenCalled();
  });
  describe('closed while its move runs', () => {
    const closeDuringMove = async props => {
      const result = deferred();
      const onMoveDay = vi.fn((_rows, _iso, options) => { onMoveDay.options = options; return result.promise; });
      setup({ onMoveDay, ...props });
      await openSheet();
      await moveTo();
      await waitFor(() => expect(onMoveDay).toHaveBeenCalled());
      fireEvent.click(document.querySelector('.health-day-move__close'));
      await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Tea' })).toBeNull());
      return { result, options: onMoveDay.options };
    };
    it('neither claims the move nor owns its failure', async () => {
      const onClaimMove = vi.fn();
      const { options, result } = await closeDuringMove({ onClaimMove });
      expect(options.ownsFailure()).toBe(false);
      options.onRetryable(Object.assign(async () => MoveResult.UNKNOWN, { operationId: 'late' }));
      await act(async () => { result.resolve(MoveResult.UNKNOWN); });
      expect(onClaimMove).not.toHaveBeenCalledWith('late');
    });
    it('owns the failure while it is open', async () => {
      const onMoveDay = vi.fn(async (_rows, _iso, options) => { onMoveDay.owned = options.ownsFailure(); return MoveResult.NOT_MOVED; });
      setup({ onMoveDay });
      await openSheet();
      await moveTo();
      await waitFor(() => expect(onMoveDay.owned).toBe(true));
    });
    it('a late success leaves a reopened sheet open', async () => {
      const { result } = await closeDuringMove();
      await openSheet();
      await act(async () => { result.resolve(MoveResult.MOVED); });
      expect(screen.getByRole('checkbox', { name: 'Tea' })).toBeTruthy();
    });
  });
  it('Escape closes only an open day menu, then the sheet, and focus returns to the button', async () => {
    setup();
    await openSheet();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tea' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move 2 selected to another day' }));
    await screen.findByRole('menuitem', { name: 'Yesterday' });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Yesterday' })).toBeNull());
    expect(screen.getByRole('checkbox', { name: 'Tea' }).checked).toBe(false);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Tea' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: MOVE })));
  });
  it('Escape still closes the sheet after the open menu went away with its control', async () => {
    setup();
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Move 3 selected to another day' }));
    await screen.findByRole('menuitem', { name: 'Yesterday' });
    for (const name of ['Eggs', 'Tea', 'Loose']) fireEvent.click(screen.getByRole('checkbox', { name }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /selected to another day/ })).toBeNull());
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Tea' })).toBeNull());
  });
  it('the day control reports its menu closed when it unmounts', () => {
    const onMenuChange = vi.fn();
    const view = render(<MantineProvider><MoveDayControl date={date} today={date} count={1} onMove={vi.fn()} onMenuChange={onMenuChange} /></MantineProvider>);
    view.unmount();
    expect(onMenuChange).toHaveBeenCalledWith(false);
  });
  it('focus goes to the field when the button left with the food', async () => {
    const view = setup();
    await openSheet();
    view.rerender({ entries: [] });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(field()));
  });
  describe('on a touch screen, where focusing the field raises the keyboard', () => {
    let restore;
    beforeEach(() => { restore = asTouchScreen(); });
    afterEach(() => restore());
    it('focus goes to the microphone when the button left with the food', async () => {
      const view = setup();
      await openSheet();
      view.rerender({ entries: [] });
      fireEvent.keyDown(document.body, { key: 'Escape' });
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Speak foods or changes' })));
    });
    it('the button still takes focus back when it is there', async () => {
      setup();
      await openSheet();
      fireEvent.keyDown(document.body, { key: 'Escape' });
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: MOVE })));
    });
    it('a typed request answered after focus left the field returns it to the microphone', async () => {
      apiMock.mockResolvedValue(done);
      const { onResult } = setup();
      screen.getByRole('button', { name: 'Send' }).focus();
      type('eggs');
      await waitFor(() => expect(onResult).toHaveBeenCalled());
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Speak foods or changes' }));
    });
    it('focus already in the field stays there', async () => {
      apiMock.mockResolvedValue(done);
      const { onResult } = setup();
      field().focus();
      type('eggs');
      await waitFor(() => expect(onResult).toHaveBeenCalled());
      expect(document.activeElement).toBe(field());
    });
    it('the bar itself takes focus when the microphone cannot', () => {
      const bar = document.body.appendChild(document.createElement('div'));
      bar.className = 'health-day-input';
      bar.innerHTML = '<div class="health-day-input__field"><input /></div><button class="health-day-input__mic" disabled></button>';
      expect(dayBarFallback(bar)).toBe(bar);
      expect(bar.getAttribute('tabindex')).toBe('-1');
      bar.remove();
    });
  });
  it('off a touch screen the fallback stays the field', () => {
    const bar = document.body.appendChild(document.createElement('div'));
    bar.className = 'health-day-input';
    bar.innerHTML = '<div class="health-day-input__field"><input /></div><button class="health-day-input__mic"></button>';
    expect(dayBarFallback(bar)).toBe(bar.querySelector('input'));
    bar.remove();
  });
  it('an empty day does not offer it', () => {
    setup({ entries: [] });
    expect(screen.queryByRole('button', { name: MOVE })).toBeNull();
  });
});
