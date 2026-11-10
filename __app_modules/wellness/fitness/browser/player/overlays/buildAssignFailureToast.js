/**
 * Map a rejected guest/strap assignment (GuestAssignmentService result) to a
 * FitnessToast payload. Shown instead of silently closing the picker, so the
 * people at the display know the pick did not take. The toast is the shared
 * fixed overlay slot — it never takes page space.
 *
 * @param {{ code?: string, message?: string, existingDeviceId?: string }} result
 * @param {{ name?: string }} [assignment]
 * @returns {{ title: string, subtitle: string, variant: string, durationMs: number }}
 */
export function buildAssignFailureToast(result, assignment = null) {
  const name = (assignment && typeof assignment === 'object' && assignment.name) || 'That rider';
  if (result?.code === 'user-already-assigned') {
    const strap = result.existingDeviceId ? `strap ${result.existingDeviceId}` : 'another strap';
    return {
      title: `${name} is already on ${strap}`,
      subtitle: 'That strap is still sending. Take it off, or remove it from the sidebar, then pick again.',
      variant: 'warning',
      durationMs: 5000,
    };
  }
  return {
    title: `Couldn't assign ${name}`,
    subtitle: result?.message || 'The assignment was not accepted.',
    variant: 'warning',
    durationMs: 5000,
  };
}

export default buildAssignFailureToast;
