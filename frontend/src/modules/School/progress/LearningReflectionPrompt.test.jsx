import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import LearningReflectionPrompt from './LearningReflectionPrompt.jsx';

const recordReflection = vi.fn();
vi.mock('../schoolApi.js', () => ({ schoolApi: { recordReflection: (...args) => recordReflection(...args) } }));
vi.mock('../identity/SchoolProfileContext.jsx', () => ({ useSchoolProfile: () => ({ currentUser: { id: 'kid-a' } }) }));

beforeEach(() => recordReflection.mockReset().mockResolvedValue({ ok: true, status: 201, data: {} }));

describe('LearningReflectionPrompt', () => {
  it('records bounded self-report evidence without any correctness field', async () => {
    const onDone = vi.fn();
    render(<LearningReflectionPrompt activity={{ id: 'probe', sessionId: 'ses-1' }} learning={{ conceptIds: ['rates'] }} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Unsure' }));
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Checked my work' }));
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    expect(await screen.findByText('Optional reflection')).toBeInTheDocument();
    expect(recordReflection).toHaveBeenCalledWith({
      observationId: 'web:ses-1:self-reflection', learnerId: 'kid-a',
      activity: { id: 'probe', sessionId: 'ses-1' }, learning: { conceptIds: ['rates'] },
      selfRegulation: {
        phase: 'self_reflection', selfAssessment: 'uncertain', confidence: 3,
        strategyIds: ['checked-work'],
      },
    });
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('allows the learner to skip without writing evidence', () => {
    const onDone = vi.fn();
    render(<LearningReflectionPrompt activity={{ id: 'quiz' }} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(recordReflection).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });
});

