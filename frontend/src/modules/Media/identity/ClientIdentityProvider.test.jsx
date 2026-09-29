import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClientIdentityProvider } from './ClientIdentityProvider.jsx';
import { useClientIdentity } from './useClientIdentity.js';
import { STORAGE_KEYS } from '../constants.js';

const useControlRegistration = vi.fn(() => ({ ready: false }));
vi.mock('../externalControl/useControlRegistration.js', () => ({ useControlRegistration: (...args) => useControlRegistration(...args) }));

function Probe() {
  const { clientId, deviceId, name, displayName, controlClientId, controlReady } = useClientIdentity();
  return <div>cid={clientId};device={deviceId};name={name};dn={displayName};control={controlClientId};ready={String(controlReady)}</div>;
}

describe('ClientIdentityProvider', () => {
  beforeEach(() => { localStorage.clear(); });

  it('generates + persists a new clientId when none present', () => {
    render(<ClientIdentityProvider><Probe /></ClientIdentityProvider>);
    const stored = localStorage.getItem(STORAGE_KEYS.CLIENT_ID);
    expect(stored).toBeTruthy();
    expect(stored.length).toBeGreaterThan(8);
    expect(screen.getByText(new RegExp(`cid=${stored};`))).toBeInTheDocument();
  });

  it('reuses an existing clientId', () => {
    localStorage.setItem(STORAGE_KEYS.CLIENT_ID, 'preset-id-1234');
    render(<ClientIdentityProvider><Probe /></ClientIdentityProvider>);
    expect(screen.getByText(/cid=preset-id-1234;/)).toBeInTheDocument();
  });

  it("defaults displayName to 'Browser <first-8>' when none stored", () => {
    localStorage.setItem(STORAGE_KEYS.CLIENT_ID, 'abcdef0123456789');
    render(<ClientIdentityProvider><Probe /></ClientIdentityProvider>);
    expect(screen.getByText(/dn=Browser abcdef01/)).toBeInTheDocument();
  });

  it('uses stored displayName if present', () => {
    localStorage.setItem(STORAGE_KEYS.CLIENT_ID, 'xx');
    localStorage.setItem(STORAGE_KEYS.DISPLAY_NAME, 'My Phone');
    render(<ClientIdentityProvider><Probe /></ClientIdentityProvider>);
    expect(screen.getByText(/dn=My Phone/)).toBeInTheDocument();
  });

  it('keeps the stored profile identity as the stable live control route', () => {
    localStorage.setItem(STORAGE_KEYS.CLIENT_ID, 'profile-persisted');
    useControlRegistration.mockReturnValueOnce({ ready: true });
    render(<ClientIdentityProvider><Probe /></ClientIdentityProvider>);

    const text = screen.getByText(/cid=profile-persisted;/).textContent;
    expect(text).toMatch(/control=.+;ready=true/);
    expect(text).toContain('control=profile-persisted;');
    expect(useControlRegistration).toHaveBeenCalledWith('profile-persisted');
    expect(localStorage.getItem(STORAGE_KEYS.CLIENT_ID)).toBe('profile-persisted');
  });

  it('uses the persisted stable client id as the one routable control owner', () => {
    localStorage.setItem(STORAGE_KEYS.CLIENT_ID, 'profile-persisted');
    render(<ClientIdentityProvider><Probe /></ClientIdentityProvider>);
    expect(screen.getByText(/device=browser:profile-persisted/)).toBeInTheDocument();
    expect(screen.getByText(/control=profile-persisted/)).toBeInTheDocument();
    expect(useControlRegistration).toHaveBeenCalledWith('profile-persisted');
  });
});
