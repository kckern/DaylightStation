import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import WebViewRenderer from './WebViewRenderer.jsx';

describe('WebViewRenderer', () => {
  it('renders an iframe pointing at mediaUrl', () => {
    const { container } = render(<WebViewRenderer initialData={{ mediaUrl: 'https://soccerfull.net/play/14360', title: 'x' }} />);
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeTruthy();
    expect(iframe.getAttribute('src')).toBe('https://soccerfull.net/play/14360');
  });
});
