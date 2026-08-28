import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClientIdentityProvider } from './ClientIdentityProvider.jsx';
import { useClientIdentity } from './useClientIdentity.js';
import { STORAGE_KEYS } from '../constants.js';

function Probe() {
  const { clientId, displayName } = useClientIdentity();
  return <div>cid={clientId};dn={displayName}</div>;
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

  it("defaults displayName to 'Client <first-8>' when none stored", () => {
    localStorage.setItem(STORAGE_KEYS.CLIENT_ID, 'abcdef0123456789');
    render(<ClientIdentityProvider><Probe /></ClientIdentityProvider>);
    expect(screen.getByText(/dn=Client abcdef01/)).toBeInTheDocument();
  });

  it('uses stored displayName if present', () => {
    localStorage.setItem(STORAGE_KEYS.CLIENT_ID, 'xx');
    localStorage.setItem(STORAGE_KEYS.DISPLAY_NAME, 'My Phone');
    render(<ClientIdentityProvider><Probe /></ClientIdentityProvider>);
    expect(screen.getByText(/dn=My Phone/)).toBeInTheDocument();
  });
});
