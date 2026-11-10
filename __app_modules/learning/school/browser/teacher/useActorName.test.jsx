import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useActorName } from "./useActorName.js";

const profile = vi.hoisted(() => ({ value: null }));
vi.mock("./TeacherProfileContext.jsx", () => ({
  useTeacherProfileOptional: () => profile.value,
}));

describe('useActorName', () => {
  it('names a rostered teacher by display name', () => {
    profile.value = { teachers: [{ id: 'teacher-a', name: 'Teacher A' }], currentTeacher: null };
    const { result } = renderHook(() => useActorName());
    expect(result.current('teacher-a')).toBe('Teacher A');
  });

  it('falls back to the raw id when the roster does not know it', () => {
    profile.value = { teachers: [{ id: 'teacher-a', name: 'Teacher A' }] };
    const { result } = renderHook(() => useActorName());
    expect(result.current('teacher-z')).toBe('teacher-z');
  });

  it('says "someone" for a record with no actor, and survives a missing provider', () => {
    profile.value = null;
    const { result } = renderHook(() => useActorName());
    expect(result.current(null)).toBe('someone');
    expect(result.current('teacher-a')).toBe('teacher-a');
  });
});
