import { render } from '@testing-library/react';
import Icon from './Icon.jsx';

// Icon returns null for unknown names, so an empty span proves the file loaded.
describe('transport icons', () => {
  it.each([
    'minus', 'plus', 'chevron-down', 'quarter-note',
    'hand-left', 'hand-right',
    'mode-listen', 'mode-learn', 'mode-polish', 'mode-perform',
    'layout-down', 'layout-across',
  ])('renders %s as inline svg', (name) => {
    const { container } = render(<Icon name={name} />);
    const span = container.querySelector('.piano-icon');
    expect(span).not.toBeNull();
    expect(span.innerHTML).toContain('<svg');
    expect(span.innerHTML).toContain('currentColor');
  });
});
