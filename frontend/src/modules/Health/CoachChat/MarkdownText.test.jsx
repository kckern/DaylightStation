// frontend/src/modules/Health/CoachChat/MarkdownText.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownText } from './MarkdownText.jsx';

describe('MarkdownText', () => {
  it('renders **bold** as <strong>', () => {
    render(<MarkdownText text="**hi**" />);
    const el = screen.getByText('hi');
    expect(el.tagName).toBe('STRONG');
  });

  it('renders bullet lists', () => {
    render(<MarkdownText text={'- one\n- two'} />);
    expect(screen.getByText('one')).toBeInTheDocument();
    expect(screen.getByText('two')).toBeInTheDocument();
    expect(screen.getByText('one').closest('ul')).not.toBeNull();
  });

  it('renders GFM tables', () => {
    const md = `
| col1 | col2 |
|---|---|
| a | b |
`.trim();
    render(<MarkdownText text={md} />);
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('a').closest('table')).not.toBeNull();
  });

  it('renders inline code', () => {
    render(<MarkdownText text={'use `metric_trajectory` here'} />);
    const el = screen.getByText('metric_trajectory');
    expect(el.tagName).toBe('CODE');
  });

  it('handles empty string without crashing', () => {
    const { container } = render(<MarkdownText text="" />);
    expect(container).toBeTruthy();
  });

  it('handles partial markdown during streaming (incomplete bold)', () => {
    render(<MarkdownText text="**hi" />);
    expect(screen.getByText(/\*\*hi/)).toBeInTheDocument();
  });
});
