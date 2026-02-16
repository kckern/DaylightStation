# First-Boot Admin Claim Flow — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow the first admin to claim their existing profile and set a password when no users have login credentials yet.

**Architecture:** `needsSetup()` changes to check for password hashes (not just profiles). A new `POST /auth/claim` endpoint lets an existing user set a password during first-boot. The LoginScreen detects setup mode from `/auth/context` and shows a two-step flow: username → set password.

**Tech Stack:** Express (backend), React + Mantine (frontend), bcrypt (password hashing), JWT (token issuance)

---

### Task 1: Update `AuthService.needsSetup()` to check for password hashes

**Files:**
- Modify: `backend/src/3_applications/auth/AuthService.mjs:17-21`
- Test: `tests/isolated/application/auth/AuthService.needsSetup.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/isolated/application/auth/AuthService.needsSetup.test.mjs
import { jest } from '@jest/globals';
import { AuthService } from '#backend/src/3_applications/auth/AuthService.mjs';

describe('AuthService.needsSetup()', () => {
  function buildService({ profiles = new Map(), loginData = {} } = {}) {
    const dataService = {
      user: {
        read: jest.fn((path, username) => loginData[username] ?? null),
        write: jest.fn(),
      },
      system: { read: jest.fn(), write: jest.fn() },
      household: { read: jest.fn(), write: jest.fn() },
    };
    const configService = {
      getAllUserProfiles: jest.fn(() => profiles),
      getDefaultHouseholdId: jest.fn(() => 'default'),
    };
    return new AuthService({ dataService, configService, logger: { info: jest.fn() } });
  }

  test('returns true when no profiles exist', () => {
    const svc = buildService({ profiles: new Map() });
    expect(svc.needsSetup()).toBe(true);
  });

  test('returns true when profiles exist but none have password hashes', () => {
    const profiles = new Map([['kckern', { username: 'kckern', roles: ['sysadmin'] }]]);
    const svc = buildService({ profiles });
    expect(svc.needsSetup()).toBe(true);
  });

  test('returns false when at least one user has a password hash', () => {
    const profiles = new Map([['kckern', { username: 'kckern', roles: ['sysadmin'] }]]);
    const loginData = { kckern: { password_hash: '$2b$10$abc...' } };
    const svc = buildService({ profiles, loginData });
    expect(svc.needsSetup()).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/application/auth/AuthService.needsSetup.test.mjs --no-coverage`
Expected: FAIL — second test passes (current impl returns false when profiles exist), third test passes trivially

**Step 3: Write minimal implementation**

Replace `needsSetup()` in `backend/src/3_applications/auth/AuthService.mjs:17-21` with:

```javascript
  needsSetup() {
    const users = this.#configService.getAllUserProfiles();
    if (users.size === 0) return true;
    for (const [username] of users) {
      const login = this.#dataService.user.read('auth/login', username);
      if (login?.password_hash) return false;
    }
    return true;
  }
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/application/auth/AuthService.needsSetup.test.mjs --no-coverage`
Expected: PASS (3/3)

**Step 5: Commit**

```bash
git add tests/isolated/application/auth/AuthService.needsSetup.test.mjs backend/src/3_applications/auth/AuthService.mjs
git commit -m "feat(auth): needsSetup checks for password hashes, not just profiles"
```

---

### Task 2: Add `AuthService.claim()` method

**Files:**
- Modify: `backend/src/3_applications/auth/AuthService.mjs` (add method after `login()`)
- Test: `tests/isolated/application/auth/AuthService.claim.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/isolated/application/auth/AuthService.claim.test.mjs
import { jest } from '@jest/globals';
import { AuthService } from '#backend/src/3_applications/auth/AuthService.mjs';

describe('AuthService.claim()', () => {
  function buildService({ profiles = new Map(), loginData = {} } = {}) {
    const written = {};
    const dataService = {
      user: {
        read: jest.fn((path, username) => {
          if (path === 'profile') return profiles.get(username) ?? null;
          if (path === 'auth/login') return loginData[username] ?? null;
          return null;
        }),
        write: jest.fn((path, data, username) => { written[`${username}/${path}`] = data; }),
      },
      system: { read: jest.fn(), write: jest.fn() },
      household: { read: jest.fn(), write: jest.fn() },
    };
    const configService = {
      getAllUserProfiles: jest.fn(() => profiles),
      getDefaultHouseholdId: jest.fn(() => 'default'),
    };
    const svc = new AuthService({ dataService, configService, logger: { info: jest.fn() } });
    return { svc, dataService, written };
  }

  test('creates login credentials and returns user info for valid profile', async () => {
    const profiles = new Map([['kckern', { username: 'kckern', household_id: 'default', roles: ['sysadmin'] }]]);
    const { svc, dataService } = buildService({ profiles });

    const result = await svc.claim('kckern', 'mypassword');

    expect(result).toEqual({ username: 'kckern', householdId: 'default', roles: ['sysadmin'] });
    expect(dataService.user.write).toHaveBeenCalledWith(
      'auth/login',
      expect.objectContaining({ password_hash: expect.any(String) }),
      'kckern'
    );
  });

  test('returns null for non-existent username', async () => {
    const { svc } = buildService({ profiles: new Map() });
    const result = await svc.claim('nobody', 'pass');
    expect(result).toBeNull();
  });

  test('throws if setup is already complete (a user has a password)', async () => {
    const profiles = new Map([['kckern', { username: 'kckern', household_id: 'default', roles: ['sysadmin'] }]]);
    const loginData = { kckern: { password_hash: '$2b$10$existing' } };
    const { svc } = buildService({ profiles, loginData });

    await expect(svc.claim('kckern', 'newpass')).rejects.toThrow('Setup already complete');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/application/auth/AuthService.claim.test.mjs --no-coverage`
Expected: FAIL — `svc.claim is not a function`

**Step 3: Write minimal implementation**

Add after the `login()` method in `backend/src/3_applications/auth/AuthService.mjs`:

```javascript
  async claim(username, password) {
    if (!this.needsSetup()) {
      throw new Error('Setup already complete');
    }

    const profile = this.#dataService.user.read('profile', username);
    if (!profile) return null;

    const passwordHash = await hashPassword(password);
    this.#dataService.user.write('auth/login', {
      password_hash: passwordHash,
      invite_token: null,
      invited_by: null,
      invited_at: null,
      last_login: new Date().toISOString()
    }, username);

    this.#logger.info('auth.claim.complete', { username });

    return {
      username: profile.username,
      householdId: profile.household_id || this.#configService.getDefaultHouseholdId(),
      roles: profile.roles || []
    };
  }
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/isolated/application/auth/AuthService.claim.test.mjs --no-coverage`
Expected: PASS (3/3)

**Step 5: Commit**

```bash
git add tests/isolated/application/auth/AuthService.claim.test.mjs backend/src/3_applications/auth/AuthService.mjs
git commit -m "feat(auth): add claim() method for first-boot password setup"
```

---

### Task 3: Add `needsSetup` to `/auth/context` response

**Files:**
- Modify: `backend/src/4_api/v1/routers/auth.mjs:65-75`

**Step 1: Update the `/auth/context` handler**

Change lines 65-75 in `backend/src/4_api/v1/routers/auth.mjs` from:

```javascript
  router.get('/context', (req, res) => {
    const householdId = req.householdId || configService.getDefaultHouseholdId();
    const household = dataService.household.read('config/household');

    res.json({
      householdId,
      householdName: household?.name || 'DaylightStation',
      authMethod: 'password',
      isLocal: req.isLocal || false
    });
  });
```

To:

```javascript
  router.get('/context', (req, res) => {
    const householdId = req.householdId || configService.getDefaultHouseholdId();
    const household = dataService.household.read('config/household');

    res.json({
      householdId,
      householdName: household?.name || 'DaylightStation',
      authMethod: 'password',
      isLocal: req.isLocal || false,
      needsSetup: authService.needsSetup()
    });
  });
```

**Step 2: Commit**

```bash
git add backend/src/4_api/v1/routers/auth.mjs
git commit -m "feat(auth): expose needsSetup in /auth/context response"
```

---

### Task 4: Add `POST /auth/claim` endpoint

**Files:**
- Modify: `backend/src/4_api/v1/routers/auth.mjs` (add after `/auth/token` handler, ~line 62)

**Step 1: Add the claim route**

Add after the `POST /auth/token` handler (after line 62):

```javascript
  // POST /auth/claim — first-boot: claim existing profile and set password
  router.post('/claim', asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Missing required fields: username, password' });
    }

    let user;
    try {
      user = await authService.claim(username, password);
    } catch (err) {
      return res.status(403).json({ error: err.message });
    }

    if (!user) {
      return res.status(404).json({ error: 'Username not found' });
    }

    const token = issueToken(user);
    logger.info('auth.claim.complete', { username });
    res.json({ token });
  }));
```

**Step 2: Commit**

```bash
git add backend/src/4_api/v1/routers/auth.mjs
git commit -m "feat(auth): add POST /auth/claim endpoint for first-boot"
```

---

### Task 5: Update LoginScreen with setup mode state machine

**Files:**
- Modify: `frontend/src/modules/Auth/LoginScreen.jsx`

**Step 1: Replace LoginScreen with setup-aware version**

Replace the full contents of `frontend/src/modules/Auth/LoginScreen.jsx`:

```jsx
// frontend/src/modules/Auth/LoginScreen.jsx
import { useState, useEffect } from 'react';
import { Stack, TextInput, Button, Text, Title, Paper, Alert } from '@mantine/core';
import { DaylightAPI } from '../../lib/api.mjs';
import { setToken } from '../../lib/auth.js';
import PasswordInput from './methods/PasswordInput.jsx';
import './Auth.scss';

export default function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [context, setContext] = useState(null);
  // 'login' = normal flow, 'setup-username' = enter username, 'setup-password' = set password
  const [step, setStep] = useState('login');

  useEffect(() => {
    DaylightAPI('/api/v1/auth/context')
      .then((ctx) => {
        setContext(ctx);
        if (ctx.needsSetup) setStep('setup-username');
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (step === 'setup-username') {
        // Just advance to password step — no API call needed
        setStep('setup-password');
        setLoading(false);
        return;
      }

      const endpoint = step === 'setup-password'
        ? '/api/v1/auth/claim'
        : '/api/v1/auth/token';

      const result = await DaylightAPI(endpoint, { username, password }, 'POST');
      setToken(result.token);
      onLogin?.();
    } catch (err) {
      if (step === 'setup-password') {
        setError('Username not found. Check and try again.');
        setStep('setup-username');
        setPassword('');
      } else {
        setError('Invalid username or password');
      }
    } finally {
      setLoading(false);
    }
  };

  const isSetup = step === 'setup-username' || step === 'setup-password';
  const subtitle = isSetup ? 'First-Time Setup' : 'DaylightStation';

  return (
    <div className="auth-container">
      <Paper className="auth-card" p="xl" radius="md">
        <form onSubmit={handleSubmit}>
          <Stack gap="md" align="center">
            <Title order={3}>{context?.householdName || 'DaylightStation'}</Title>
            <Text c="dimmed" size="sm">{subtitle}</Text>

            {step === 'setup-password' ? (
              <Text size="sm" w="100%">
                Setting password for <strong>{username}</strong>
              </Text>
            ) : (
              <TextInput
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.currentTarget.value)}
                w="100%"
              />
            )}

            {step !== 'setup-username' && (
              <div style={{ width: '100%' }}>
                <PasswordInput
                  value={password}
                  onChange={setPassword}
                  label={step === 'setup-password' ? 'Choose a Password' : undefined}
                />
              </div>
            )}

            {error && <Alert color="red" w="100%">{error}</Alert>}

            <Button
              type="submit"
              loading={loading}
              fullWidth
              disabled={
                step === 'setup-username' ? !username :
                step === 'setup-password' ? !password :
                !username || !password
              }
            >
              {step === 'setup-username' ? 'Continue' :
               step === 'setup-password' ? 'Set Password & Sign In' :
               'Sign In'}
            </Button>
          </Stack>
        </form>
      </Paper>
    </div>
  );
}
```

**Step 2: Update PasswordInput to accept optional label prop**

In `frontend/src/modules/Auth/methods/PasswordInput.jsx`, replace with:

```jsx
// frontend/src/modules/Auth/methods/PasswordInput.jsx
import { PasswordInput as MantinePasswordInput } from '@mantine/core';

export default function PasswordInput({ value, onChange, label = 'Password' }) {
  return (
    <MantinePasswordInput
      label={label}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      placeholder="Enter your password"
    />
  );
}
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Auth/LoginScreen.jsx frontend/src/modules/Auth/methods/PasswordInput.jsx
git commit -m "feat(auth): add first-boot claim flow to LoginScreen"
```

---

### Task 6: Manual smoke test

**Step 1: Verify no login.yml exists for kckern**

```bash
ls data/users/kckern/auth/login.yml  # Should not exist
```

**Step 2: Start dev server and open the app**

Open the admin app in browser. Should see:
- Title: "Default Household"
- Subtitle: "First-Time Setup"
- Username field only, "Continue" button

**Step 3: Enter username and continue**

- Type `kckern`, click Continue
- Should see: "Setting password for **kckern**", password field with toggle, "Set Password & Sign In" button

**Step 4: Set password and sign in**

- Enter a password, click "Set Password & Sign In"
- Should log in successfully and see the admin dashboard
- `data/users/kckern/auth/login.yml` should now exist with a `password_hash`

**Step 5: Reload — should now show normal login**

- Refresh the page
- Should see normal login form (username + password)
- Log in with the password you just set
