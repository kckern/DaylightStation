/**
 * The slug a score is filed under: practice records and the score's Learn file
 * share it, so the two always name the same piece. Lowercase, runs of anything
 * but letters and digits become one '-', trimmed, at most 120 characters.
 */
export const practiceKeyOfScore = (id) => String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
