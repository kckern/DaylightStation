/** Canonical practice-part identity for a zero-based global score staff. */
export const partIdForStaff = (staff) => (
  staff === 0 ? 'rh' : staff === 1 ? 'lh' : `p${staff + 1}`
);

export default partIdForStaff;
