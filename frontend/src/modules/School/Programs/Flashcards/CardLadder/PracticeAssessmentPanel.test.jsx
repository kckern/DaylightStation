import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PracticeAssessmentPanel from './PracticeAssessmentPanel.jsx';
it('offers explicit printing only when ready and distinguishes daily practice from lesson progress', () => {
 const print = vi.fn();
 const view = render(<PracticeAssessmentPanel progress={{stage:'practice',totalQuestions:6,resolvedQuestionIds:[],missingCardIds:['a']}} onPrint={print} />);
 expect(screen.queryByRole('button',{name:'Print quiz'})).not.toBeInTheDocument();
 expect(screen.getByText(/1 card.*recognition and matching/i)).toBeInTheDocument();
 view.rerender(<PracticeAssessmentPanel progress={{stage:'quiz_ready',totalQuestions:6,resolvedQuestionIds:[]}} onPrint={print} />);
 fireEvent.click(screen.getByRole('button',{name:'Print quiz'}));
 expect(print).toHaveBeenCalledTimes(1);
});
it('shows missed-skill explanations, a focused review action and retained question credit', () => {
 const review=vi.fn();
 render(<PracticeAssessmentPanel progress={{stage:'review',totalQuestions:6,resolvedQuestionIds:['q1','q2','q3','q4'],pendingReviewCardIds:['a'],feedback:[{questionId:'q5',explanation:'Ask permission with -아/어도 돼요.'}]}} onReview={review} />);
 expect(screen.getByText('4 of 6 questions resolved')).toBeInTheDocument();
 expect(screen.getByText('Ask permission with -아/어도 돼요.')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Review missed skills'}));
 expect(review).toHaveBeenCalledTimes(1);
});
