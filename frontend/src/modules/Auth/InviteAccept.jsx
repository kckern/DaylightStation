// frontend/src/modules/Auth/InviteAccept.jsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Stack, TextInput, Button, Text, Title, Paper, Alert, Loader, Center } from '@mantine/core';
import { PasswordInput } from '@mantine/core';
import { DaylightAPI } from '../../lib/api.mjs';
import { setToken } from '../../lib/auth.js';
import './Auth.scss';

export default function InviteAccept() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [invite, setInvite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    DaylightAPI(`/api/v1/auth/invite/${token}`)
      .then((data) => {
        setInvite(data);
        setDisplayName(data.displayName || '');
        setLoading(false);
      })
      .catch(() => {
        setInvalid(true);
        setLoading(false);
      });
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await DaylightAPI(`/api/v1/auth/invite/${token}/accept`, {
        password,
        displayName
      }, 'POST');
      setToken(result.token);
      navigate('/');
    } catch {
      setError('Failed to accept invite. The link may have expired.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="auth-container">
        <Center><Loader /></Center>
      </div>
    );
  }

  if (invalid) {
    return (
      <div className="auth-container">
        <Paper className="auth-card" p="xl" radius="md">
          <Stack align="center" gap="md">
            <Title order={3}>Invalid Invite</Title>
            <Text c="dimmed">This invite link is invalid or has already been used.</Text>
          </Stack>
        </Paper>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <Paper className="auth-card" p="xl" radius="md">
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            <Title order={3}>Welcome, {invite.username}</Title>
            <Text c="dimmed" size="sm">Set up your account to get started.</Text>

            <TextInput
              label="Display Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.currentTarget.value)}
            />
            <PasswordInput
              label="Password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              placeholder="At least 8 characters"
            />
            <PasswordInput
              label="Confirm Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.currentTarget.value)}
              error={confirmPassword && password !== confirmPassword ? 'Passwords do not match' : null}
            />

            {error && <Alert color="red">{error}</Alert>}

            <Button
              type="submit"
              loading={submitting}
              disabled={!password || password.length < 8 || password !== confirmPassword}
              fullWidth
            >
              Create Account
            </Button>
          </Stack>
        </form>
      </Paper>
    </div>
  );
}
