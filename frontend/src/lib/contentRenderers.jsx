import React from 'react';
import { generateReference } from 'scripture-guide';
import { convertVersesToScriptureData, scriptureDataToJSX } from './scripture-guide.jsx';

// Narrated renderers (used by NarratedScroller)
const narratedRenderers = {
  scripture: {
    cssType: 'scriptures',
    parseContent: (contentData) => {
      if (!contentData?.data) return null;
      const blocks = convertVersesToScriptureData(contentData.data);
      return <div className="scripture-text">{scriptureDataToJSX(blocks)}</div>;
    },
    extractTitle: (data) => {
      if (data.resolved?.verseId) {
        try { return generateReference(data.resolved.verseId).replace(/:1$/, ''); }
        catch { /* fall through */ }
      }
      return data.metadata?.reference || data.title;
    },
    extractSubtitle: (data) => {
      const verses = data.content?.data;
      if (Array.isArray(verses) && verses[0]?.headings) {
        const { title, subtitle } = verses[0].headings;
        const parts = [title, subtitle].filter(Boolean);
        if (parts.length) return parts.join(' \u2022 ');
      }
      return data.subtitle;
    }
  }
};

// Singing renderers (used by SingingScroller)
const singingRenderers = {
  hymn:    { cssType: 'hymn', wrapperClass: 'hymn-text' },
  primary: { cssType: 'hymn', wrapperClass: 'hymn-text' }
};

// Exported helpers
export function getCollectionFromContentId(contentId) {
  // "narrated:scripture/dc88" -> "scripture"
  // "singing:hymn/2" -> "hymn"
  if (!contentId) return null;
  const afterPrefix = contentId.replace(/^(narrated|singing):/, '');
  return afterPrefix.split('/')[0] || null;
}

export function getNarratedRenderer(collection)  { return narratedRenderers[collection] || null; }
export function getSingingRenderer(collection)   { return singingRenderers[collection] || null; }
