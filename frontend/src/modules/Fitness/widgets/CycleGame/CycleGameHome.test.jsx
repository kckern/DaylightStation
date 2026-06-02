import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import CycleGameHome from './CycleGameHome.jsx';

const courses = [
  { id: 'alps_3k', name: 'Alps · 3 km', win_condition: 'distance', goal_m: 3000 },
  { id: 'coastal_5min', name: 'Coastal · 5 min', win_condition: 'time', time_cap_s: 300 }
];
const riders = [
  { userId: 'milo', displayName: 'Milo', equipmentId: 'cycle_ace', live: true },
  { userId: 'felix', displayName: 'Felix', equipmentId: 'tricycle', live: false }
];

describe('CycleGameHome', () => {
  it('lists courses and the rider lineup', () => {
    const { getByText } = render(<CycleGameHome courses={courses} riders={riders} records={[]} />);
    expect(getByText('Alps · 3 km')).toBeTruthy();
    expect(getByText('Coastal · 5 min')).toBeTruthy();
    expect(getByText('Milo')).toBeTruthy();
  });
  it('fires onSelectCourse when a course is chosen', () => {
    const onSelectCourse = vi.fn();
    const { getByTestId } = render(<CycleGameHome courses={courses} riders={riders} records={[]} onSelectCourse={onSelectCourse} />);
    fireEvent.click(getByTestId('course-alps_3k'));
    expect(onSelectCourse).toHaveBeenCalledWith(courses[0]);
  });
  it('renders the records panel rows', () => {
    const records = [{ courseId: 'alps_3k', userId: 'milo', label: 'Milo — 4:12' }];
    const { getByText } = render(<CycleGameHome courses={courses} riders={riders} records={records} />);
    expect(getByText('Milo — 4:12')).toBeTruthy();
  });
});
