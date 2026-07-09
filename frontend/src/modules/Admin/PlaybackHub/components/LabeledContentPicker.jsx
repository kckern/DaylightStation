// LabeledContentPicker — thin alias for the unified ContentCombobox.
//
// The unified combobox renders its own resolved-title line beneath the input
// (data-testid "combobox-resolved-title"), so this wrapper's former title
// <Text>, useContentTitle hook, and titleCache seeding were removed — they
// produced a doubled title line (2026-07-09 audit, C6). The file stays as a
// re-export so the three PlaybackHub call sites (TransportRow,
// ScheduledFiresSection, SchedulesSection) and their test mocks keyed on this
// path don't churn. PlaybackHub summary rows still resolve titles through
// hooks/useContentTitle.js + utils/titleCache.js, which remain in use.
import ContentCombobox from '../../ContentLists/combobox/ContentCombobox.jsx';

export const LabeledContentPicker = ContentCombobox;
export default ContentCombobox;
