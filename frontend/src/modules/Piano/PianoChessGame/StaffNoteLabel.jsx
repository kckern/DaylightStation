/**
 * Re-export shim.
 *
 * StaffNoteLabel moved into the addressed-board family (Task 4, "the staff
 * address rail") because chess was no longer its only user — Checkers now
 * addresses squares the same way, and Connect Four's column rail draws the
 * same cards. This file exists only so chess's own `./StaffNoteLabel.jsx`
 * import keeps resolving; the implementation and its stylesheet both live at
 * the family location now.
 */
export { StaffNoteLabel, default } from '../game-platform/families/addressed-board/StaffNoteLabel.jsx';
