import { useState, useCallback } from 'react';
import { Group, TextInput, ActionIcon, Loader } from '@mantine/core';
import { IconSend } from '@tabler/icons-react';

export function ChatInput({ onSend, loading, placeholder = 'Type a message...' }) {
  const [value, setValue] = useState('');

  const handleSend = useCallback(() => {
    if (!value.trim() || loading) return;
    onSend(value.trim());
    setValue('');
  }, [value, loading, onSend]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <Group gap="xs" p="sm" style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}>
      <TextInput
        flex={1}
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={loading}
      />
      <ActionIcon onClick={handleSend} disabled={!value.trim() || loading} variant="filled">
        {loading ? <Loader size={14} /> : <IconSend size={14} />}
      </ActionIcon>
    </Group>
  );
}
