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
        if (ctx.needsSetup && ctx.setupAdmin) {
          // Sysadmin exists — autofill and skip to password step
          setUsername(ctx.setupAdmin);
          setStep('setup-password');
        } else if (ctx.needsSetup) {
          setStep('setup-username');
        }
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (step === 'setup-username') {
      setStep('setup-password');
      return;
    }

    const claiming = step === 'setup-password';
    setLoading(true);
    let result;
    try {
      result = await DaylightAPI(claiming ? '/api/v1/auth/claim' : '/api/v1/auth/token', { username, password }, 'POST');
    } catch {
      if (claiming) {
        setError('Username not found. Check and try again.');
        setStep('setup-username');
        setPassword('');
      } else {
        setError('Invalid username or password');
      }
      return;
    } finally {
      setLoading(false);
    }

    try {
      setToken(result.token);
    } catch {
      setStep('login');
      setPassword('');
      const accepted = claiming ? 'Your password was set.' : 'Your sign-in was accepted.';
      setError(accepted + ' This browser could not save your session. Allow site storage or free up space, then sign in again.');
      return;
    }
    onLogin?.();
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
