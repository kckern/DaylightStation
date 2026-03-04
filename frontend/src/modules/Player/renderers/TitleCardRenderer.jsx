import { useEffect, useRef, useMemo } from 'react';
import { computeZoomTarget } from './ImageFrame.jsx';
import getLogger from '../../../lib/logging/Logger.js';
import './TitleCardRenderer.scss';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'TitleCardRenderer' });
  return _logger;
}

const TEMPLATES = {
  centered: CenteredTemplate,
  'section-header': SectionHeaderTemplate,
  credits: CreditsTemplate,
  'lower-third': LowerThirdTemplate,
};

export function TitleCardRenderer({ media, advance, resilienceBridge }) {
  const timerRef = useRef(null);
  const containerRef = useRef(null);
  const bgRef = useRef(null);

  const slideshow = useMemo(() => media?.slideshow || {}, [media?.slideshow]);
  const card = useMemo(() => media?.titlecard || {}, [media?.titlecard]);
  const duration = (slideshow.duration || 5) * 1000;
  const effect = slideshow.effect || 'none';
  const zoom = slideshow.zoom || 1.2;

  const TemplateComponent = TEMPLATES[card.template] || TEMPLATES.centered;
  const themeClass = `titlecard--theme-${card.theme || 'default'}`;

  // ResilienceBridge mock — title cards aren't real media elements
  useEffect(() => {
    if (resilienceBridge) {
      const onStartup = resilienceBridge.current?.onStartupSignal;
      resilienceBridge.current = {
        get currentTime() { return 0; },
        get duration() { return slideshow.duration || 5; },
        get paused() { return false; },
        play() { return Promise.resolve(); },
        pause() {},
        onStartupSignal: onStartup,
      };
      // Signal startup so the resilience overlay dismisses
      if (typeof onStartup === 'function') onStartup();
    }
  }, [resilienceBridge, slideshow.duration]);

  // Ken Burns on background image
  useEffect(() => {
    const bgEl = bgRef.current;
    if (!bgEl || !card.imageUrl || effect !== 'kenburns') return;

    const target = computeZoomTarget({ people: [], focusPerson: null, zoom });
    bgEl.animate([
      { transform: `scale(1.0) translate(${target.startX}, ${target.startY})` },
      { transform: `scale(${zoom}) translate(${target.endX}, ${target.endY})` },
    ], {
      duration,
      easing: 'ease-in-out',
      fill: 'forwards',
    });
  }, [media?.id, card.imageUrl, effect, zoom, duration]);

  // Auto-advance timer
  useEffect(() => {
    logger().info('titlecard-show', {
      id: media?.id,
      template: card.template,
      duration: duration / 1000,
    });

    timerRef.current = setTimeout(() => {
      logger().debug('titlecard-advance', { id: media?.id });
      advance?.();
    }, duration);

    return () => clearTimeout(timerRef.current);
  }, [media?.id, duration, advance]);

  return (
    <div ref={containerRef} className={`titlecard ${themeClass}`}>
      {card.imageUrl && (
        <img
          ref={bgRef}
          className="titlecard__bg"
          src={card.imageUrl}
          alt=""
          draggable={false}
        />
      )}
      <div className="titlecard__overlay">
        <TemplateComponent text={card.text || {}} css={card.css || {}} />
      </div>
    </div>
  );
}

// --- Template Components ---

function CenteredTemplate({ text, css }) {
  return (
    <div className="titlecard-tpl titlecard-tpl--centered" style={css.container}>
      {text.title && (
        <h1 className="titlecard-tpl__title" style={css.title}>{text.title}</h1>
      )}
      {text.subtitle && (
        <p className="titlecard-tpl__subtitle" style={css.subtitle}>{text.subtitle}</p>
      )}
    </div>
  );
}

function SectionHeaderTemplate({ text, css }) {
  return (
    <div className="titlecard-tpl titlecard-tpl--section-header" style={css.container}>
      {text.title && (
        <h1 className="titlecard-tpl__title" style={css.title}>{text.title}</h1>
      )}
      {text.subtitle && (
        <p className="titlecard-tpl__subtitle" style={css.subtitle}>{text.subtitle}</p>
      )}
    </div>
  );
}

function CreditsTemplate({ text, css }) {
  return (
    <div className="titlecard-tpl titlecard-tpl--credits" style={css.container}>
      {text.title && (
        <h1 className="titlecard-tpl__title" style={css.title}>{text.title}</h1>
      )}
      {text.lines?.map((line, i) => (
        <p key={i} className="titlecard-tpl__line" style={css.lines}>{line}</p>
      ))}
    </div>
  );
}

function LowerThirdTemplate({ text, css }) {
  return (
    <div className="titlecard-tpl titlecard-tpl--lower-third" style={css.container}>
      {text.title && (
        <h2 className="titlecard-tpl__title" style={css.title}>{text.title}</h2>
      )}
      {text.subtitle && (
        <p className="titlecard-tpl__subtitle" style={css.subtitle}>{text.subtitle}</p>
      )}
    </div>
  );
}
