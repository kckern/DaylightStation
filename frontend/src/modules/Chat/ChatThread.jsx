import { useRef, useEffect, useMemo } from 'react';
import { Stack, Paper, Text, Button, Group, Badge, ThemeIcon } from '@mantine/core';
import { IconRobot, IconUser, IconThumbUp, IconThumbDown } from '@tabler/icons-react';
import getLogger from '../../lib/logging/Logger.js';

export function ChatThread({ messages, onAction, onFeedback }) {
  const logger = useMemo(() => getLogger().child({ component: 'chat-thread' }), []);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <Stack gap="sm" style={{ flex: 1, overflow: 'auto', padding: '1rem' }}>
      {messages.map((msg, i) => (
        <MessageBubble key={i} msg={msg} onAction={onAction} onFeedback={onFeedback} />
      ))}
      <div ref={bottomRef} />
    </Stack>
  );
}

function MessageBubble({ msg, onAction, onFeedback }) {
  const isUser = msg.role === 'user';

  return (
    <Group align="flex-start" justify={isUser ? 'flex-end' : 'flex-start'} wrap="nowrap">
      {!isUser && (
        <ThemeIcon variant="light" size="sm" radius="xl">
          <IconRobot size={14} />
        </ThemeIcon>
      )}
      <Paper
        shadow="xs"
        p="sm"
        radius="md"
        style={{
          maxWidth: '75%',
          backgroundColor: isUser ? 'var(--mantine-color-blue-light)' : 'var(--mantine-color-gray-0)',
        }}
      >
        {msg.type === 'proposal' && msg.proposal ? (
          <ProposalCard proposal={msg.proposal} onAction={onAction} />
        ) : msg.type === 'action' && msg.actions ? (
          <ActionMessage content={msg.content} actions={msg.actions} onAction={onAction} />
        ) : (
          <Text size="sm">{msg.content}</Text>
        )}

        {!isUser && msg.type === 'text' && onFeedback && (
          <Group gap="xs" mt="xs">
            <Button variant="subtle" size="compact-xs" onClick={() => onFeedback('positive', msg.content)}>
              <IconThumbUp size={12} />
            </Button>
            <Button variant="subtle" size="compact-xs" onClick={() => onFeedback('negative', msg.content)}>
              <IconThumbDown size={12} />
            </Button>
          </Group>
        )}
      </Paper>
      {isUser && (
        <ThemeIcon variant="light" size="sm" radius="xl" color="blue">
          <IconUser size={14} />
        </ThemeIcon>
      )}
    </Group>
  );
}

function ProposalCard({ proposal, onAction }) {
  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>Proposed Change</Text>
      <Text size="sm">{proposal.reasoning}</Text>
      <Badge size="sm" variant="light">Confidence: {Math.round(proposal.confidence * 100)}%</Badge>
      <Group gap="xs">
        <Button size="xs" onClick={() => onAction?.('accept_proposal', proposal)}>Accept</Button>
        <Button size="xs" variant="light" onClick={() => onAction?.('modify_proposal', proposal)}>Modify</Button>
        <Button size="xs" variant="subtle" onClick={() => onAction?.('dismiss_proposal', proposal)}>Dismiss</Button>
      </Group>
    </Stack>
  );
}

function ActionMessage({ content, actions, onAction }) {
  return (
    <Stack gap="xs">
      <Text size="sm">{content}</Text>
      <Group gap="xs">
        {actions.map((a, i) => (
          <Button key={i} size="xs" variant="light" onClick={() => onAction?.(a.action, a.data)}>
            {a.label}
          </Button>
        ))}
      </Group>
    </Stack>
  );
}
