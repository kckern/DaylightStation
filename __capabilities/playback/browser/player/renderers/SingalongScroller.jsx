import React, { useCallback, useRef } from 'react';
import ContentScroller from './ContentScroller.jsx';
import { useScrollerContent } from '../hooks/useScrollerContent.js';
import { useCenterByWidest } from "../../player-support/useCenterByWidest.js";
import { getSingalongRenderer } from "../../../../content-catalog/browser/providers/contentRenderers.jsx";

/**
 * SingalongScroller
 * ----------------
 * Wraps ContentScroller for singalong content (hymns, primary songs).
 *
 * Features:
 *  - Uses the supplied descriptor or reads it from the content info endpoint
 *  - Parses stanza content (array of stanzas, each an array of lines)
 *  - Applies style via CSS variables
 *  - Uses useCenterByWidest hook for horizontal placement (left-biased, see below)
 *  - Calculates yStartTime for scrolling based on duration/verses
 */
export function SingalongScroller({
  contentId,
  initialData,
  advance,
  manualAdvance = advance,
  clear,
  volume,
  playbackKeys,
  ignoreKeys,
  queuePosition,
  onPlaybackMetrics,
  onRegisterMediaAccess,
  seekToIntentSeconds,
  onSeekRequestConsumed,
  remountDiagnostics,
  listId
}) {
  const data = useScrollerContent(contentId, initialData);
  const textRef = useRef(null);
  const renderer = getSingalongRenderer();
  const cssType = renderer.cssType;
  const wrapperClass = renderer.wrapperClass;

  // Place the lyric block by its widest line, biased LEFT of true centre. The
  // lines are left-aligned and ragged right (and only each stanza's first line is
  // flush left — the rest carry a 2rem indent), so the block's bounding box
  // centres well right of where the text looks centred. 0.35 puts a third of the
  // free space on the left: clearly indented, never flush.
  useCenterByWidest(textRef, [data?.content?.data], { bias: 0.35 });

  const parseContent = useCallback((contentData) => {
    if (!contentData?.data) return null;

    return (
      <div className={wrapperClass} ref={textRef}>
        {contentData.data.map((stanza, sIdx) => (
          <div key={`stanza-${sIdx}`} className="stanza">
            {stanza.map((line, lIdx) => (
              <p key={`line-${sIdx}-${lIdx}`} className="line">{line}</p>
            ))}
          </div>
        ))}
      </div>
    );
  }, [wrapperClass]);

  if (!data) return null;

  // Apply style as CSS variables.
  //
  // NOTE: for singalong these are inert. No rule reads --font-size or
  // --font-family, and only `.poetry-text` reads --color/--text-align/
  // --background. Hymn size comes from `.hymn-text, .singalong-text
  // { font-size: 2rem }` in styles/ContentScroller.scss. Do not "fix" this by
  // wiring --font-size through: SingalongAdapter._getDefaultStyle() hardcodes
  // 1.4rem with no per-item override, so every hymn would shrink 30%.
  const cssVars = {
    '--font-family': data.style?.fontFamily || 'serif',
    '--font-size': data.style?.fontSize || '1.4rem',
    '--text-align': data.style?.textAlign || 'center',
    '--background': data.style?.background || 'transparent',
    '--color': data.style?.color || 'inherit'
  };

  // Calculate yStartTime based on duration and verse count
  // If API doesn't provide duration (returns 0), fall back to default 15s
  // ContentScroller discovers real duration from the audio element's loadedmetadata event
  const verseCount = data.content?.data?.length || 1;
  const yStartTime = data.duration ? (data.duration / verseCount) / 1.8 : 15;

  // Process volume parameter (same logic as Hymns)
  const mainVolume = (() => {
    if (!volume) return 1; // default for singalong
    let processedVolume = parseFloat(volume);
    if (processedVolume < 1 && processedVolume > 0) {
      processedVolume = processedVolume * 100;
    }
    if (processedVolume === 1) {
      processedVolume = 100;
    }
    return processedVolume / 100;
  })();

  return (
    <div style={cssVars} data-visual-type={cssType} className="singalong-scroller">
      <ContentScroller
        key={`singalong-${contentId}`}
        type={cssType}
        title={data.title}
        assetId={data.id || contentId}
        subtitle={data.subtitle}
        mainMediaUrl={data.mediaUrl}
        mainVolume={mainVolume}
        contentData={data.content}
        parseContent={parseContent}
        onAdvance={advance}
        onManualAdvance={manualAdvance}
        onClear={clear}
        playbackKeys={playbackKeys}
        ignoreKeys={ignoreKeys}
        queuePosition={queuePosition}
        yStartTime={yStartTime}
        onPlaybackMetrics={onPlaybackMetrics}
        onRegisterMediaAccess={onRegisterMediaAccess}
        seekToIntentSeconds={seekToIntentSeconds}
        onSeekRequestConsumed={onSeekRequestConsumed}
        remountDiagnostics={remountDiagnostics}
        listId={listId}
        manualScrollNudge
      />
    </div>
  );
}

export default SingalongScroller;
