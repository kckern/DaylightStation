import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ScreenHeader from '../shared/ScreenHeader.jsx';
import PanelFrame from '../teacher/panels/PanelFrame.jsx';
import EmptyState from '../home/EmptyState.jsx';
import CardLadderStage from '../Programs/Flashcards/CardLadder/CardLadderStage.jsx';
import { SchoolSurfaceProvider } from './SchoolSurface.jsx';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('Portal family migration', () => {
  it('shares compact focusable controls across header, teacher retry and empty actions', () => {
    const retry = vi.fn();
    const exit = vi.fn();
    render(<SchoolSurfaceProvider density="compact"><ScreenHeader title="Reading" onBack={() => {}} onDone={exit} /><PanelFrame title="History" state="error" retry={retry} /><EmptyState title="Empty" actionLabel="Browse" onAction={() => {}} /></SchoolSurfaceProvider>);
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done).toHaveAttribute('data-density', 'compact');
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveAttribute('data-density', 'compact');
    expect(screen.getByRole('button', { name: 'Browse' })).toHaveAttribute('data-density', 'compact');
    const back = screen.getByRole('button', { name: 'Back' });
    expect(back.querySelector('.school-screen-header__back-icon').parentElement).toBe(back);
    done.focus();
    expect(done).toHaveFocus();
    fireEvent.click(done);
    expect(exit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('uses shared async state presentation while retaining unavailable and editable-form policy', () => {
    const view = render(<><PanelFrame title="History" state="unavailable" unavailableCopy="History is unavailable" /><PanelFrame title="Form" state="empty" alwaysRender><input aria-label="Draft" /></PanelFrame><EmptyState title="Nothing yet" hint="Choose a course" /></>);
    expect(screen.getByText('History is unavailable').closest('.ds-state')).toBeInTheDocument();
    expect(screen.getByText('Nothing yet').closest('.ds-state')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Draft' })).toBeInTheDocument();
    expect(view.container.querySelectorAll('.teacher-panel')).toHaveLength(2);
  });

  it('fits a declared Card Ladder stage to its measured host without screen-config requests', () => {
    let resize;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { resize = callback; }
      observe(target) { this.target = target; resize([{ target, contentRect: target.classList.contains('wl-stage-frame') ? { width: 160, height: 100 } : { width: 320, height: 240 } }]); }
      disconnect() {}
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const view = render(<SchoolSurfaceProvider><CardLadderStage referenceSize={{ width: 1280, height: 800 }}><p>Stage content</p></CardLadderStage></SchoolSurfaceProvider>);
    expect(screen.getByText('Stage content')).toBeInTheDocument();
    const stage = view.container.querySelector('.wl-stage');
    expect(stage.style.width).toBe('1280px');
    expect(stage.style.transform).toBe('scale(0.125)');
    expect(view.container.querySelectorAll('.ds-root')).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
