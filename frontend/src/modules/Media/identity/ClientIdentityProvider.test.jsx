import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClientIdentityProvider, useClientIdentity, CLIENT_ID_KEY, DISPLAY_NAME_KEY } from './ClientIdentityProvider.jsx';

function Probe() {
  const { clientId, displayName } = useClientIdentity();
  return <div>cid={clientId};dn={displayName}</div>;
}

describe('ClientIdentityProvider', () => {
  beforeEach(() => { localStorage.clear(); });

  it('generates + persists a new clientId when none present', () => {
    render(<ClientIdentityProvider><Probe /></ClientIdentityProvider>);
    const stored = localStorage.getItem(CLIENT_ID_KEY);
    expect(stored).toBeTruthy();
    expect(stored.length).toBeGreaterThan(8);
    expect(screen.getByText(new RegExp(`cid=${stored};`))).toBeInTheDocument();
  });

  it('reuses an existing clientId', () => {
    localStorage.setItem(CLIENT_ID_KEY, 'preset-id-1234');
    render(<ClientIdentityProvider><Probe /></ClientIdentityProvider>);
    expect(screen.getByText(/cid=preset-id-1234;/)).toBeInTheDocument();
  });

  it("defaults displayName to 'Client <first-8>' when none stored", () => {
    localStorage.setItem(CLIENT_ID_KEY, 'abcdef0123456789');
    render(<ClientIdentityProvider><Probe /></ClientIdentityProvider>);
    expect(screen.getByText(/dn=Client abcdef01/)).toBeInTheDocument();
  });

  it('uses stored displayName if present', () => {
    localStorage.setItem(CLIENT_ID_KEY, 'xx');
    localStorage.setItem(DISPLAY_NAME_KEY, 'My Phone');
    render(<ClientIdentityProvider><Probe /></ClientIdentityProvider>);
    expect(screen.getByText(/dn=My Phone/)).toBeInTheDocument();
  });
});
