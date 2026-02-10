import React from 'react';
import { generateReference } from 'scripture-guide';
import { convertVersesToScriptureData, scriptureDataToJSX } from './scripture-guide.jsx';

// Readalong format renderer (used by ReadalongScroller).
// Auto-detects scripture data structure for enhanced rendering;
// non-scripture content (talks, poetry) falls through to scroller defaults.
const readalongRenderer = {
  parseContent: (contentData) => {
    if (!contentData?.data) return null;
    // Only apply scripture-guide rendering when the data has verse structure
    const verses = contentData.data;
    if (contentData.type !== 'verses' || !Array.isArray(verses)) return null;
    const blocks = convertVersesToScriptureData(verses);
    return <div className="scripture-text">{scriptureDataToJSX(blocks)}</div>;
  },
  extractTitle: (data) => {
    // resolved may be at top level or nested in metadata (backend passes it in metadata object)
    const verseId = data.resolved?.verseId || data.metadata?.resolved?.verseId;
    if (verseId) {
      try { return generateReference(verseId).replace(/:1$/, ''); }
      catch { /* fall through */ }
    }
    return data.metadata?.reference || data.title;
  },
  extractSubtitle: (data) => {
    const verses = data.content?.data;
    if (Array.isArray(verses) && verses[0]?.headings) {
      const { heading, section_title } = verses[0].headings;
      const parts = [heading, section_title].filter(Boolean);
      if (parts.length) return parts.join(' \u2022 ');
    }
    return data.subtitle;
  }
};

// Singalong format renderer (used by SingalongScroller).
// All singalong collections (hymn, primary) share the same config.
const singalongRenderer = { cssType: 'singalong', wrapperClass: 'singalong-text' };

// Format-level accessors — no collection parameter needed.
export function getReadalongRenderer()  { return readalongRenderer; }
export function getSingalongRenderer()  { return singalongRenderer; }
