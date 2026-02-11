import React, { useState, useRef } from 'react';
import { TextInput, Group, Badge, ActionIcon, Text } from '@mantine/core';
import { IconX } from '@tabler/icons-react';

/**
 * TagInput - Reusable multi-value tag input for email lists, keywords, labels, etc.
 *
 * Props:
 * - values: string[] - current tag values
 * - onChange: (string[]) => void - called when tags change
 * - placeholder: string - input placeholder text
 * - label: string - optional label above the input
 */
function TagInput({ values = [], onChange, placeholder = 'Type and press Enter', label }) {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef(null);

  function addTag(raw) {
    const tag = raw.trim();
    if (!tag) return;
    if (values.includes(tag)) {
      setInputValue('');
      return;
    }
    onChange([...values, tag]);
    setInputValue('');
  }

  function removeTag(index) {
    const next = values.filter((_, i) => i !== index);
    onChange(next);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === 'Backspace' && inputValue === '' && values.length > 0) {
      removeTag(values.length - 1);
    }
  }

  function handleBlur() {
    addTag(inputValue);
  }

  return (
    <div>
      {label && (
        <Text size="sm" fw={500} mb={4}>
          {label}
        </Text>
      )}
      {values.length > 0 && (
        <Group gap={4} wrap="wrap" mb={6}>
          {values.map((tag, index) => (
            <Badge
              key={`${tag}-${index}`}
              variant="light"
              pr={3}
              rightSection={
                <ActionIcon
                  size="xs"
                  variant="transparent"
                  color="gray"
                  onClick={() => removeTag(index)}
                  aria-label={`Remove ${tag}`}
                >
                  <IconX size={12} />
                </ActionIcon>
              }
            >
              {tag}
            </Badge>
          ))}
        </Group>
      )}
      <TextInput
        ref={inputRef}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={placeholder}
        size="sm"
      />
    </div>
  );
}

export default TagInput;
