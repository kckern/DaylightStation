import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

// Route-level test only — each tab's own module (TodayView, ProgressView,
// MedicalView, CoachChat) has its own test suite already. Stubbing them here
// keeps this suite focused on HealthApp's own job: mapping /health/* paths
// to tabs and back, per the LifeApp `/life/*` precedent.
vi.mock('../modules/Health/today/TodayView.jsx', () => ({ TodayView: () => <div>TodayStub</div> }));
vi.mock('../modules/Health/progress/ProgressView.jsx', () => ({ ProgressView: () => <div>ProgressStub</div> }));
vi.mock('../modules/Health/medical/MedicalView.jsx', () => ({ MedicalView: () => <div>MedicalStub</div> }));
vi.mock('../modules/Health/CoachChat', () => ({ default: () => <div>CoachStub</div> }));
vi.mock('../modules/Health/ChatOverlay/index.jsx', () => ({ ChatOverlay: () => null }));

import HealthApp from './HealthApp.jsx';

let lastPath = null;
function LocationProbe() {
  lastPath = useLocation().pathname;
  return null;
}

function renderApp(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/health" element={<><HealthApp /><LocationProbe /></>} />
        <Route path="/health/*" element={<><HealthApp /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => { lastPath = null; });

describe('HealthApp routed tabs', () => {
  it('/health renders Today and highlights the Today tab', async () => {
    renderApp('/health');
    expect(await screen.findByText('TodayStub')).toBeTruthy();
    expect(document.querySelector('.ds-chrome__tab--active')?.textContent).toContain('Today');
  });

  it('/health/progress renders Progress directly (deep link)', async () => {
    renderApp('/health/progress');
    expect(await screen.findByText('ProgressStub')).toBeTruthy();
    expect(document.querySelector('.ds-chrome__tab--active')?.textContent).toContain('Progress');
  });

  it('/health/medical renders the Health (medical) tab directly (deep link)', async () => {
    renderApp('/health/medical');
    expect(await screen.findByText('MedicalStub')).toBeTruthy();
    expect(document.querySelector('.ds-chrome__tab--active')?.textContent).toContain('Health');
  });

  it('/health/coach renders Coach directly (deep link)', async () => {
    renderApp('/health/coach');
    expect(await screen.findByText('CoachStub')).toBeTruthy();
    expect(document.querySelector('.ds-chrome__tab--active')?.textContent).toContain('Coach');
  });

  it('an unknown /health subpath renders Today rather than a blank/404 tab', async () => {
    renderApp('/health/bogus-subpath');
    expect(await screen.findByText('TodayStub')).toBeTruthy();
  });

  it('tapping the Progress tab navigates to /health/progress', async () => {
    renderApp('/health');
    await screen.findByText('TodayStub');
    fireEvent.click(screen.getByRole('link', { name: 'Progress' }));
    expect(await screen.findByText('ProgressStub')).toBeTruthy();
    expect(lastPath).toBe('/health/progress');
  });

  it('tapping the Today tab from a deep link returns to /health', async () => {
    renderApp('/health/progress');
    await screen.findByText('ProgressStub');
    fireEvent.click(screen.getByRole('link', { name: 'Today' }));
    expect(await screen.findByText('TodayStub')).toBeTruthy();
    expect(lastPath).toBe('/health');
  });
});
