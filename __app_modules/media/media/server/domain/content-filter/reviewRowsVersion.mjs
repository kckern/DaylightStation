/**
 * The shape version of the Admin review rows an audit stores (cli/contentfilter/reviewRows.mjs).
 * Bumped when a row gains a field the page needs; an audit stored with another version counts as
 * out of date, so opening the film rebuilds its list. 2: every EDL part is a row (`acts`) and each
 * row carries its `timing` (owner, 2026-11-21).
 */
export const REVIEW_ROWS_VERSION = 2;
