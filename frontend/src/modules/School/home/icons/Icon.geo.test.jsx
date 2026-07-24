import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Icon from './Icon.jsx';

describe('geography topic icons', () => {
  ['geography', 'states', 'capitals', 'flags', 'countries'].forEach((name) => {
    it(`renders the ${name} icon`, () => {
      const { container } = render(<Icon name={name} label={name} />);
      expect(container.querySelector('svg')).toBeTruthy();
    });
  });
});
