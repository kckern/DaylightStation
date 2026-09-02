import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import InterventionsIndex from './InterventionsIndex.jsx';

describe('InterventionsIndex', () => {
  it('lists every tool with its situation', () => {
    render(<InterventionsIndex learnerId="user_4" />);
    expect(screen.getByText('Give credit for work you saw')).toBeInTheDocument();
    expect(screen.getByText(/the tech lost it/i)).toBeInTheDocument();
  });

  it('links learner-scoped tools at the learner', () => {
    render(<InterventionsIndex learnerId="user_4" />);
    expect(screen.getByRole('link', { name: /Give credit for work you saw/ }))
      .toHaveAttribute('href', '/school/teacher/students/user_4/operations');
  });

  it('renders session-scoped tools as guidance, not dead links', () => {
    render(<InterventionsIndex learnerId="user_4" />);
    const row = screen.getByText('Fix a marked answer').closest('li');
    expect(row.querySelector('a')).toBeNull();
    expect(row).toHaveTextContent(/Open the lesson from the day record/);
  });

  it('can narrow to one scope', () => {
    render(<InterventionsIndex learnerId="user_4" scopes={['learner']} />);
    expect(screen.getByText('Give credit for work you saw')).toBeInTheDocument();
    expect(screen.queryByText('Re-mark a whole batch')).not.toBeInTheDocument();
  });
});
