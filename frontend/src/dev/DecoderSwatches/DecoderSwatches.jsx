// frontend/src/dev/DecoderSwatches/DecoderSwatches.jsx
//
// Red decoder card check. Open this on the screen that shows party games and
// hold the card up: every signal bar should stay bright, every mask bar should
// go dark, and the live sample should read clearly. Dev-only route; lazy-loaded
// so it never rides in the main bundle.
import { useEffect } from 'react';
import getLogger from '../../lib/logging/Logger.js';
import SegmentedSecretText from '@gaming-ui/SegmentedSecretText.jsx';
import { MASK_SEGMENT_COLORS, SIGNAL_SEGMENT_COLORS, segmentColorValue } from '@gaming-ui/segmentedSecretPalette.js';
import './DecoderSwatches.scss';

const SAMPLE = 'B8 SPHINX OF BLACK QUARTZ JUDGE MY VOW';

function SwatchRow({ title, hint, colors }) {
  return (
    <section className="decoder-swatches__row">
      <h2>{title}</h2>
      <p>{hint}</p>
      <ul>
        {colors.map(color => (
          <li key={color.token}>
            <span className="decoder-swatches__bar" style={{ '--swatch-color': segmentColorValue(color) }} />
            <span className="decoder-swatches__name">{color.name}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function DecoderSwatches() {
  useEffect(() => {
    getLogger().child({ component: 'decoder-swatches' }).info('gaming.decoder-swatches.mounted', {
      signal: SIGNAL_SEGMENT_COLORS.length,
      mask: MASK_SEGMENT_COLORS.length,
    });
  }, []);

  return (
    <main className="party-games decoder-swatches">
      <header>
        <h1>Decoder swatches</h1>
        <p>Hold the red decoder card over this screen.</p>
      </header>
      <SwatchRow title="Signal" hint="Each bar should stay bright through the card." colors={SIGNAL_SEGMENT_COLORS} />
      <SwatchRow title="Mask" hint="Each bar should go dark through the card." colors={MASK_SEGMENT_COLORS} />
      <section className="decoder-swatches__sample">
        <h2>Live sample</h2>
        <p>Should read clearly through the card, B and 8 included.</p>
        <SegmentedSecretText text={SAMPLE} label="Decoder sample" />
      </section>
    </main>
  );
}
