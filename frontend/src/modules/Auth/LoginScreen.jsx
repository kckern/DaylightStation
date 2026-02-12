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

  useEffect(() => {
    DaylightAPI('/api/v1/auth/context')
      .then(setContext)
      .catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI('/api/v1/auth/token', { username, password }, 'POST');
      setToken(result.token);
      onLogin?.();
    } catch {
      setError('Invalid username or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <Paper className="auth-card" p="xl" radius="md">
        <form onSubmit={handleSubmit}>
          <Stack gap="md" align="center">
            <Title order={3}>{context?.householdName || 'DaylightStation'}</Title>
            <Text c="dimmed" size="sm">DaylightStation</Text>

            <TextInput
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.currentTarget.value)}
              w="100%"
            />
            <div style={{ width: '100%' }}>
              <PasswordInput value={password} onChange={setPassword} />
            </div>

            {error && <Alert color="red" w="100%">{error}</Alert>}

            <Button type="submit" loading={loading} fullWidth disabled={!username || !password}>
              Sign In
            </Button>
          </Stack>
        </form>
      </Paper>
    </div>
  );
}
