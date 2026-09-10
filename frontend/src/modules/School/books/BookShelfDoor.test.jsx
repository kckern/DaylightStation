import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../schoolApi.js', () => ({ schoolApi: { bookScans: { open: (...a) => h.open(...a) } } }));
vi.mock('../schoolLog.js', () => ({ schoolLog: { bookShelf: vi.fn(), bookShelfError: vi.fn() } }));
vi.mock('../../../lib/identity/ProfileAvatar.jsx', () => ({ default: () => <span>avatar</span> }));

import BookShelfDoor from './BookShelfDoor.jsx';

const props = {
  screenId: 'portal',
  roster: [{ id: 'child', name: 'Child' }, { id: 'sibling', name: 'Sibling' }],
  onLaunch: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  h.open.mockResolvedValue({ ok: true, data: { launchTarget: { kind: 'program', program: 'book-log', learnerId: 'child', bookGrant: 'panel-grant' }, bookEntry: null } });
});

describe('BookShelfDoor', () => {
  it('asks who is reading, then opens that shelf at the pad — no code, no scan', async () => {
    render(<BookShelfDoor {...props} />);
    fireEvent.click(screen.getByTestId('book-shelf-door'));
    expect(screen.getByRole('dialog', { name: 'Who is logging a book' })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Child' })));
    expect(h.open).toHaveBeenCalledWith({ screenId: 'portal', learnerId: 'child' });
    // `openAdd` is the door's whole reason to exist: the child came to type a
    // number, so the shelf must not land on the tiles.
    expect(props.onLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ bookGrant: 'panel-grant', bookEntry: null, openAdd: true }),
      'child',
    );
  });

  it('shows the door, not the faces, until it is asked', () => {
    render(<BookShelfDoor {...props} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Child' })).toBeNull();
  });

  it('backs out without opening anything', async () => {
    render(<BookShelfDoor {...props} />);
    fireEvent.click(screen.getByTestId('book-shelf-door'));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(h.open).not.toHaveBeenCalled();
    expect(props.onLaunch).not.toHaveBeenCalled();
  });

  it('names a refusal in the server’s words and opens nothing', async () => {
    h.open.mockResolvedValue({ ok: false, status: 403, data: { error: { message: 'Choose a current School learner.' } } });
    render(<BookShelfDoor {...props} />);
    fireEvent.click(screen.getByTestId('book-shelf-door'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Child' })));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a current School learner.');
    expect(props.onLaunch).not.toHaveBeenCalled();
    // The faces stay up: a refusal is not a reason to make them start over.
    expect(screen.getByRole('button', { name: 'Sibling' })).toBeTruthy();
  });

  it('drops a late answer for a child who has walked away', async () => {
    let finish;
    h.open.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<BookShelfDoor {...props} />);
    fireEvent.click(screen.getByTestId('book-shelf-door'));
    fireEvent.click(screen.getByRole('button', { name: 'Child' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await act(async () => finish({ ok: true, data: { launchTarget: { bookGrant: 'stale' } } }));
    expect(props.onLaunch).not.toHaveBeenCalled();
  });

  it('takes one answer per ask, however many faces are jabbed', async () => {
    render(<BookShelfDoor {...props} />);
    fireEvent.click(screen.getByTestId('book-shelf-door'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Child' }));
      fireEvent.click(screen.getByRole('button', { name: 'Sibling' }));
    });
    expect(h.open).toHaveBeenCalledTimes(1);
    expect(props.onLaunch).toHaveBeenCalledTimes(1);
  });
});
