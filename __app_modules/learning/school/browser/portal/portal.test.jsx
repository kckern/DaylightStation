import { createRef } from 'react';
import { createPortal } from 'react-dom';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppThemeProvider } from '#frontend/lib/ui/AppThemeProvider.jsx';
import { SchoolSurfaceProvider, useSchoolSurface } from './SchoolSurface.jsx';
import { SchoolActivityFrame } from './SchoolActivityFrame.jsx';
import { SchoolButton } from './SchoolButton.jsx';
import { SchoolSelect } from './SchoolSelect.jsx';
import { compile } from 'sass-embedded';
import { fileURLToPath } from 'node:url';
const portalCss = compile(fileURLToPath(new URL('./SchoolPortal.scss', import.meta.url))).css;
const controlCss = compile(fileURLToPath(new URL('../../../../../frontend/src/lib/ui/TouchButton.scss', import.meta.url))).css;

let observers;
beforeEach(() => {
  observers = [];
  // The repository DOM environment does not expose PointerEvent. Keep real
  // mouse coordinates/button semantics instead of Testing Library's bare Event.
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    constructor(type, init = {}) { super(type, init); this.isPrimary = init.isPrimary ?? true; }
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
    resize(width, height) { this.callback([{ target: this.target, contentRect: { width, height } }]); }
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Probe({ name }) {
  const scope = useSchoolSurface();
  return <div data-testid={name}>
    <output>{JSON.stringify({ ...scope, overlayRoot: undefined, resourceStore: undefined, provided: undefined, api: undefined })}</output>
    {scope.overlayRoot && createPortal(<span>{name} overlay</span>, scope.overlayRoot)}
  </div>;
}

// These checks catch global scope/theme ownership and window-size measurements.
describe('school surfaces', () => {
  it('keeps identity, bounds and overlay ownership separate for two mounted surfaces', () => {
    const view = render(<>
      <SchoolSurfaceProvider surfaceId="desk" deviceId="desk-device"><Probe name="desk" /></SchoolSurfaceProvider>
      <SchoolSurfaceProvider surfaceId="wall" deviceId="wall-device" density="compact"><Probe name="wall" /></SchoolSurfaceProvider>
    </>);
    act(() => { observers[0].resize(420, 320); observers[1].resize(960, 540); });
    expect(JSON.parse(screen.getByTestId('desk').querySelector('output').textContent)).toEqual({ surfaceId: 'desk', deviceId: 'desk-device', density: 'touch', bounds: { width: 420, height: 320 } });
    expect(JSON.parse(screen.getByTestId('wall').querySelector('output').textContent)).toEqual({ surfaceId: 'wall', deviceId: 'wall-device', density: 'compact', bounds: { width: 960, height: 540 } });
    const hosts = view.container.querySelectorAll('.school-surface');
    expect(within(hosts[0]).getByText('desk overlay')).toBeInTheDocument();
    expect(within(hosts[0]).queryByText('wall overlay')).toBeNull();
    expect(within(hosts[1]).getByText('wall overlay')).toBeInTheDocument();
    view.unmount();
    expect(observers.every(observer => observer.disconnected)).toBe(true);
  });

  it('applies one school pack across nested hosts and restores the outer context', () => {
    const view = render(<AppThemeProvider pack="health"><SchoolSurfaceProvider surfaceId="outer">
      <SchoolSurfaceProvider surfaceId="inner" density="compact"><Probe name="inner" /></SchoolSurfaceProvider>
      <Probe name="outer" />
    </SchoolSurfaceProvider></AppThemeProvider>);
    expect(view.container.querySelectorAll('.ds-root')).toHaveLength(2);
    expect(screen.getByTestId('inner').textContent).toContain('"surfaceId":"inner"');
    expect(screen.getByTestId('outer').textContent).toContain('"surfaceId":"outer"');
    const schoolTheme = view.container.querySelector('.ds-root .ds-root');
    expect(schoolTheme.style.getPropertyValue('--ds-accent')).toBe('#51cf66');
  });

  it('provides safe browser defaults without measuring the window', () => {
    render(<Probe name="fallback" />);
    expect(JSON.parse(screen.getByTestId('fallback').querySelector('output').textContent)).toEqual({ surfaceId: 'browser', deviceId: null, density: 'touch', bounds: { width: 0, height: 0 } });
  });

  it('does not let non-finite measurements escape into consumer sizing', () => {
    render(<SchoolSurfaceProvider><Probe name="invalid" /></SchoolSurfaceProvider>);
    act(() => observers[0].resize(Infinity, -12));
    expect(screen.getByTestId('invalid').textContent).toContain('"bounds":{"width":0,"height":0}');
  });


  it('keeps resource stores stable within one surface and isolated from another', async () => {
    const stores = {}, apis = {};
    function ResourceProbe({ name }) { const surface = useSchoolSurface(); stores[name] = surface.resourceStore; apis[name] = surface.api; return null; }
    const view = render(<><SchoolSurfaceProvider surfaceId="one" deviceId="one-device"><ResourceProbe name="one" /></SchoolSurfaceProvider><SchoolSurfaceProvider surfaceId="two" deviceId="two-device"><ResourceProbe name="two" /></SchoolSurfaceProvider></>);
    const first = stores.one;
    const firstApi = apis.one;
    expect(firstApi).toBeDefined();
    expect(firstApi).not.toBe(apis.two);
    expect(first).toBeDefined();
    expect(first).not.toBe(stores.two);
    await act(async () => first.read(['course', 'learner'], async () => ({ ok: true, status: 200, data: ['ready'] })));
    expect(first.getSnapshot(['course', 'learner']).data).toEqual(['ready']);
    expect(stores.two.getSnapshot(['course', 'learner']).data).toBeNull();
    view.rerender(<><SchoolSurfaceProvider surfaceId="one" deviceId="one-device"><ResourceProbe name="one" /></SchoolSurfaceProvider><SchoolSurfaceProvider surfaceId="two" deviceId="two-device"><ResourceProbe name="two" /></SchoolSurfaceProvider></>);
    expect(stores.one).toBe(first);
    expect(apis.one).toBe(firstApi);
  });

  it('works without ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    render(<SchoolSurfaceProvider><Probe name="plain" /></SchoolSurfaceProvider>);
    expect(screen.getByTestId('plain').textContent).toContain('"bounds":{"width":0,"height":0}');
  });
});

// Removing native props/ref forwarding or duplicating press activation breaks these flows.
describe('school controls', () => {
  it('forwards native button ref, form association and submission', () => {
    const ref = createRef();
    const submit = vi.fn(event => event.preventDefault());
    render(<><form id="lesson" onSubmit={submit} /><SchoolButton ref={ref} type="submit" form="lesson" name="action" value="finish" aria-busy="false">Finish</SchoolButton></>);
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Finish' }));
    expect(ref.current.name).toBe('action');
    expect(ref.current.value).toBe('finish');
    expect(ref.current).toHaveAttribute('aria-busy', 'false');
    fireEvent.click(ref.current);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('keeps release activation and specialized pointer handlers native', () => {
    const activate = vi.fn();
    const pointer = vi.fn();
    render(<SchoolButton onClick={activate} onPointerDown={pointer}>Answer</SchoolButton>);
    const button = screen.getByRole('button');
    fireEvent.pointerDown(button, { button: 0 });
    expect(pointer).toHaveBeenCalledTimes(1);
    expect(activate).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('activates on press once, preserving native submit and later keyboard clicks', () => {
    const activate = vi.fn();
    const submit = vi.fn(event => event.preventDefault());
    render(<form onSubmit={submit}><SchoolButton type="submit" activation="press" onClick={activate}>Play</SchoolButton></form>);
    const button = screen.getByRole('button');
    fireEvent.pointerDown(button, { button: 0, isPrimary: true });
    expect(activate).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(button, { button: 0 });
    fireEvent.click(button, { detail: 1 });
    expect(activate).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    fireEvent.click(button, { detail: 0 });
    expect(activate).toHaveBeenCalledTimes(2);
  });

  it('keeps click cancellation effective for native press submission', () => {
    const submit = vi.fn(event => event.preventDefault());
    render(<form onSubmit={submit}><SchoolButton activation="press" type="submit" onClick={event => event.preventDefault()}>Cancel submit</SchoolButton></form>);
    fireEvent.pointerDown(screen.getByRole('button'), { button: 0 });
    fireEvent.click(screen.getByRole('button'), { detail: 1 });
    expect(submit).not.toHaveBeenCalled();
  });

  it('honors prevented presses, secondary pointers and busy disabling', () => {
    const activate = vi.fn();
    const view = render(<SchoolButton activation="press" onPointerDown={event => event.preventDefault()} onClick={activate}>Play</SchoolButton>);
    fireEvent.pointerDown(screen.getByRole('button'), { button: 0 });
    expect(activate).not.toHaveBeenCalled();
    view.rerender(<SchoolButton activation="press" onClick={activate}>Play</SchoolButton>);
    fireEvent.pointerDown(screen.getByRole('button'), { button: 2 });
    expect(activate).not.toHaveBeenCalled();
    view.rerender(<SchoolButton activation="press" busy onClick={activate}>Play</SchoolButton>);
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
    fireEvent.pointerDown(screen.getByRole('button'), { button: 0 });
    fireEvent.click(screen.getByRole('button'));
    expect(activate).not.toHaveBeenCalled();
  });

  it('inherits compact density, permits touch override, and preserves select change/ref', () => {
    const ref = createRef();
    const changes = [];
    render(<SchoolSurfaceProvider density="compact">
      <SchoolButton>Save</SchoolButton><SchoolButton density="touch">Start</SchoolButton>
      <SchoolSelect ref={ref} aria-label="Course" name="course" defaultValue="math" onChange={event => changes.push(event.target.value)}>
        <option value="math">Math</option><option value="art">Art</option>
      </SchoolSelect>
    </SchoolSurfaceProvider>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('data-density', 'compact');
    expect(screen.getByRole('button', { name: 'Start' })).toHaveAttribute('data-density', 'touch');
    expect(ref.current).toBe(screen.getByRole('combobox'));
    expect(ref.current.name).toBe('course');
    fireEvent.change(ref.current, { target: { value: 'art' } });
    expect(changes).toEqual(['art']);
    ref.current.focus();
    expect(ref.current).toHaveFocus();
  });

  it('uses touch and compact hit areas while retaining keyboard focus and disabled state', () => {
    const style = document.createElement('style');
    style.textContent = controlCss;
    document.head.append(style);
    render(<SchoolSurfaceProvider><SchoolButton>Touch</SchoolButton><SchoolButton density="compact">Compact</SchoolButton><SchoolButton disabled>Unavailable</SchoolButton><SchoolSelect aria-label="Disabled choice" disabled><option>Choice</option></SchoolSelect></SchoolSurfaceProvider>);
    const touch = screen.getByRole('button', { name: 'Touch' });
    const compact = screen.getByRole('button', { name: 'Compact' });
    expect(getComputedStyle(touch).minHeight).toBe('64px');
    expect(getComputedStyle(compact).minHeight).toBe('36px');
    touch.focus();
    expect(touch).toHaveFocus();
    compact.focus();
    expect(compact).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Unavailable' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Disabled choice' })).toBeDisabled();
    style.remove();
  });
});

describe('school activity frame', () => {
  it('leaves chrome to an existing activity when no header slots are provided', () => {
    const view = render(<SchoolActivityFrame className="school-activity--adapter"><button>Done</button></SchoolActivityFrame>);
    expect(view.container.querySelector('header')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Done' })).toHaveLength(1);
  });
  it.each(['workspace', 'focus', 'split', 'media', 'board'])('renders %s slots and dispatches back/done independently', layout => {
    const back = vi.fn();
    const done = vi.fn();
    render(<SchoolActivityFrame layout={layout} title="Lesson" identity={<span>Student</span>} progress={<progress aria-label="Lesson progress" value="1" max="3" />} onBack={back} onDone={done} actions={<button>Hint</button>} feedback="Try again"><p>Prompt</p><p>Workspace</p></SchoolActivityFrame>);
    expect(screen.getByRole('region', { name: 'Lesson' })).toHaveAttribute('data-layout', layout);
    expect(screen.getByText('Student')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '1');
    expect(screen.getByRole('status')).toHaveTextContent('Try again');
    expect(screen.getByRole('button', { name: 'Hint' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(back).toHaveBeenCalledTimes(1);
    expect(done).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('contains frame and overlay overflow inside a constrained surface', () => {
    const style = document.createElement('style');
    style.textContent = portalCss;
    document.head.append(style);
    const view = render(<div style={{ width: 320, height: 240 }}><SchoolSurfaceProvider><SchoolActivityFrame title="Small cell"><div style={{ width: 1200, height: 900 }}>Large board</div></SchoolActivityFrame></SchoolSurfaceProvider></div>);
    const host = view.container.querySelector('.school-surface');
    const frame = screen.getByRole('region', { name: 'Small cell' });
    expect(getComputedStyle(host).position).toBe('relative');
    expect(getComputedStyle(host).overflow).toBe('hidden');
    expect(getComputedStyle(frame).minHeight).toBe('0');
    expect(getComputedStyle(frame.querySelector('.school-activity__content')).overflow).toBe('auto');
    expect(getComputedStyle(view.container.querySelector('.school-surface__overlays')).position).toBe('absolute');
    style.remove();
  });
});
