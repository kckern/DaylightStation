import React, { useState, useEffect, useCallback } from 'react';
import ContentScroller from './ContentScroller.jsx';
import { DaylightAPI } from '../../../lib/api.mjs';
import { getReadalongRenderer } from '../../../lib/contentRenderers.jsx';

/**
 * ReadalongScroller
 * -----------------
 * Wraps ContentScroller for readalong content (scripture, talks, poetry).
 *
 * Features:
 *  - Fetches data from /api/v1/item/readalong/{path}
 *  - Supports verses content type (scripture-style with verse numbers)
 *  - Supports paragraphs content type (talks, poetry)
 *  - Video mode (if data.videoUrl exists)
 *  - Ambient audio (if data.ambientUrl exists)
 *  - Applies style via CSS variables
 */
export function ReadalongScroller({
  contentId,
  initialData,
  advance,
  clear,
  volume,
  playbackKeys,
  ignoreKeys,
  queuePosition,
  onPlaybackMetrics,
  onRegisterMediaAccess,
  seekToIntentSeconds,
  onSeekRequestConsumed,
  remountDiagnostics
}) {
  const [data, setData] = useState(initialData || null);
  const renderer = getReadalongRenderer();

  useEffect(() => {
    // Skip fetch if data was provided by parent (e.g., SinglePlayer already fetched it)
    if (initialData) { setData(initialData); return; }
    if (!contentId) return;

    // Convert contentId to URL path segments for the info endpoint.
    // Handles any prefix: readalong:scripture/..., talk:ldsgc/..., scripture:alma-32, etc.
    const path = contentId.includes(':')
      ? contentId.replace(':', '/')
      : contentId;

    DaylightAPI(`api/v1/info/${path}`).then(response => {
      setData(response);
    });
  }, [contentId, initialData]);

  // Determine wrapper class: talks use "talk-text" to match legacy CSS, others use "readalong-text"
  const contentCssType = data?.type || data?.metadata?.cssType;
  const textWrapperClass = contentCssType === 'talk' ? 'talk-text' : 'readalong-text';

  const parseContent = useCallback((contentData) => {
    // Try renderer first (handles scripture verses with special formatting)
    if (renderer?.parseContent) {
      const result = renderer.parseContent(contentData);
      if (result) return result;
    }

    // Plain array of strings (talks, poetry) — most common for non-scripture
    if (Array.isArray(contentData)) {
      return (
        <div className={`${textWrapperClass} paragraphs`}>
          {contentData.map((para, idx) => {
            if (typeof para === 'string' && para.startsWith('##')) {
              return <h4 key={idx}>{para.slice(2).trim()}</h4>;
            }
            return <p key={idx}>{typeof para === 'string' ? para : ''}</p>;
          })}
        </div>
      );
    }

    // Structured { type, data } format
    if (!contentData?.data) return null;

    if (contentData.type === 'verses') {
      return (
        <div className="readalong-text verses">
          {contentData.data.map((verse, idx) => (
            <p key={idx} className="verse">
              <span className="verse-num">{verse.verse}</span>
              <span className="verse-text">{verse.text}</span>
            </p>
          ))}
        </div>
      );
    }

    // Structured paragraphs
    return (
      <div className={`${textWrapperClass} paragraphs`}>
        {contentData.data.map((para, idx) => {
          if (typeof para === 'string' && para.startsWith('##')) {
            return <h4 key={idx}>{para.slice(2).trim()}</h4>;
          }
          return <p key={idx}>{typeof para === 'string' ? para : ''}</p>;
        })}
      </div>
    );
  }, [renderer, textWrapperClass]);

  if (!data) return null;

  const title = renderer?.extractTitle ? renderer.extractTitle(data) : data.title;
  const subtitle = renderer?.extractSubtitle ? renderer.extractSubtitle(data) : data.subtitle;
  // Determine CSS type from backend data, with fallback for verse content
  const rawCssType = data.type || data.metadata?.cssType || renderer?.cssType
    || (data.content?.type === 'verses' ? 'scriptures' : null)
    || 'readalong';
  // CSS class mapping: collection names that differ from their CSS class
  const CSS_TYPE_MAP = { scripture: 'scriptures' };
  const cssType = CSS_TYPE_MAP[rawCssType] || rawCssType;

  // Apply style as CSS variables
  const cssVars = {
    '--font-family': data.style?.fontFamily || 'sans-serif',
    '--font-size': data.style?.fontSize || '1.2rem',
    '--text-align': data.style?.textAlign || 'left',
    '--background': data.style?.background || 'transparent',
    '--color': data.style?.color || 'inherit'
  };

  const isVideo = !!data.videoUrl || data.mediaType === 'video';

  // Process volume parameter (same pattern as other scrollers)
  const mainVolume = (() => {
    if (!volume) return 1; // default
    let processedVolume = parseFloat(volume);
    if (processedVolume > 1) {
      processedVolume = processedVolume / 100; // Convert percentage to decimal
    }
    return Math.min(1, Math.max(0, processedVolume));
  })();

  // Make ambient volume always 10% of main volume
  const ambientVolume = (() => {
    if (!volume) return 0.1; // default 10% when no volume specified
    const proportionalAmbient = mainVolume * 0.1; // Always 10% of main volume
    return Math.max(0.001, proportionalAmbient); // Ensure minimum audible volume
  })();

  return (
    <div style={cssVars} data-visual-type={cssType} className="readalong-scroller">
      <ContentScroller
        key={`readalong-${contentId}`}
        type={cssType}
        title={title}
        assetId={contentId}
        subtitle={subtitle}
        mainMediaUrl={isVideo ? data.videoUrl : data.mediaUrl}
        isVideo={isVideo}
        mainVolume={mainVolume}
        ambientMediaUrl={data.ambientUrl || null}
        ambientConfig={{
          fadeOutStep: 0.01,
          fadeOutInterval: 400,
          fadeInDelay: 750,
          ambientVolume: ambientVolume
        }}
        contentData={data.content}
        parseContent={parseContent}
        onAdvance={advance}
        onClear={clear}
        playbackKeys={playbackKeys}
        ignoreKeys={ignoreKeys}
        queuePosition={queuePosition}
        yStartTime={isVideo ? 30 : 15}
        onPlaybackMetrics={onPlaybackMetrics}
        onRegisterMediaAccess={onRegisterMediaAccess}
        seekToIntentSeconds={seekToIntentSeconds}
        onSeekRequestConsumed={onSeekRequestConsumed}
        remountDiagnostics={remountDiagnostics}
      />
    </div>
  );
}

export default ReadalongScroller;