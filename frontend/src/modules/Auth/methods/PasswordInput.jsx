// frontend/src/modules/Auth/methods/PasswordInput.jsx
import { PasswordInput as MantinePasswordInput } from '@mantine/core';

export default function PasswordInput({ value, onChange }) {
  return (
    <MantinePasswordInput
      label="Password"
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      placeholder="Enter your password"
    />
  );
}
