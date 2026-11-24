import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import IsolatedMemoryRouter from './IsolatedMemoryRouter.jsx';

let go;
function Inner() {
  const location = useLocation();
  go = useNavigate();
  return <p data-testid="inner">{location.pathname}{location.search}</p>;
}
function Outer() {
  const location = useLocation();
  return <p data-testid="outer">{location.pathname}</p>;
}

describe('IsolatedMemoryRouter', () => {
  it('renders inside the screen router, where a plain MemoryRouter throws', () => {
    expect(() => render(
      <MemoryRouter initialEntries={['/screen/office']}><MemoryRouter><Inner /></MemoryRouter></MemoryRouter>,
    )).toThrow(/inside another <Router>/);
  });

  it('keeps its own location, separate from the screen route', () => {
    render(
      <MemoryRouter initialEntries={['/screen/office']}>
        <Routes>
          <Route path="/screen/:id" element={<><Outer /><IsolatedMemoryRouter><Routes><Route path="*" element={<Inner />} /></Routes></IsolatedMemoryRouter></>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('inner').textContent).toBe('/');
    act(() => go('/?passage=p2'));
    expect(screen.getByTestId('inner').textContent).toBe('/?passage=p2');
    expect(screen.getByTestId('outer').textContent).toBe('/screen/office');
  });
});
