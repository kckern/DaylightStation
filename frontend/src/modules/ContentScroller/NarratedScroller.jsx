import React, { useState, useEffect, useCallback } from 'react';
import ContentScroller from './ContentScroller.jsx';
import { DaylightAPI, DaylightMediaPath } from '../../lib/api.mjs';
import { getNarratedRenderer, getCollectionFromContentId } from '../../lib/contentRenderers.jsx';

/**
 * NarratedScroller
 * ----------------
 * Wraps ContentScroller for narrated content (scripture, talks, poetry).
 *
 * Features:
 *  - Fetches data from /api/v1/item/narrated/{path}
 *  - Supports verses content type (scripture-style with verse numbers)
 *  - Supports paragraphs content type (talks, poetry)
 *  - Video mode (if data.videoUrl exists)
 *  - Ambient audio (if data.ambientUrl exists)
 *  - Applies style via CSS variables
 */
export function NarratedScroller({
  contentId,
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
  const [data, setData] = useState(null);
  const collection = getCollectionFromContentId(contentId);
  const renderer = getNarratedRenderer(collection);

  useEffect(() => {
    if (!contentId) return;

    // Extract path from contentId (narrated:scripture/bom/... → scripture/bom/...)
    const path = contentId.replace(/^narrated:/, '');

    DaylightAPI(`api/v1/info/narrated/${path}`).then(response => {
      setData(response);
    });
  }, [contentId]);

  const parseContent = useCallback((contentData) => {
    if (renderer?.parseContent) return renderer.parseContent(contentData);

    if (!contentData?.data) return null;

    if (contentData.type === 'verses') {
      // Scripture-style verses
      return (
        <div className="narrated-text verses">
          {contentData.data.map((verse, idx) => (
            <p key={idx} className="verse">
              <span className="verse-num">{verse.verse}</span>
              <span className="verse-text">{verse.text}</span>
            </p>
          ))}
        </div>
      );
    }

    // Paragraphs (talks, poetry, etc.)
    return (
      <div className="narrated-text paragraphs">
        {contentData.data.map((para, idx) => {
          if (para.startsWith('##')) {
            return <h4 key={idx}>{para.slice(2).trim()}</h4>;
          }
          return <p key={idx}>{para}</p>;
        })}
      </div>
    );
  }, [renderer]);

  if (!data) return null;

  const title = renderer?.extractTitle ? renderer.extractTitle(data) : data.title;
  const subtitle = renderer?.extractSubtitle ? renderer.extractSubtitle(data) : data.subtitle;
  const cssType = renderer?.cssType || 'narrated';

  // Apply style as CSS variables
  const cssVars = {
    '--font-family': data.style?.fontFamily || 'sans-serif',
    '--font-size': data.style?.fontSize || '1.2rem',
    '--text-align': data.style?.textAlign || 'left',
    '--background': data.style?.background || 'transparent',
    '--color': data.style?.color || 'inherit'
  };

  const isVideo = !!data.videoUrl;

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
    <div style={cssVars} data-visual-type={cssType} className="narrated-scroller">
      <ContentScroller
        key={`narrated-${contentId}`}
        type={cssType}
        title={title}
        assetId={contentId}
        subtitle={subtitle}
        mainMediaUrl={isVideo ? data.videoUrl : data.mediaUrl}
        isVideo={isVideo}
        mainVolume={mainVolume}
        ambientMediaUrl={data.ambientUrl}
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

export default NarratedScroller;
