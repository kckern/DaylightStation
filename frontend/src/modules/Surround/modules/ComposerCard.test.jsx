import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import ComposerCard, { ASSET_WARN_PER_MINUTE } from './ComposerCard.jsx';

const makeLogger = () => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn(),
});

const DATA = {
  contentId: 'plex:663134',
  assetBase: 'surround/classical',
  composer: {
    name: 'Ludwig van Beethoven',
    born: 1770,
    died: 1827,
    birthplace: 'Bonn (Electorate of Cologne)',
    portrait: 'beethoven/portrait.jpg',
  },
  piece: {
    title: 'Symphony No. 3 in E-flat major, "Eroica"',
    opus: 'Op. 55',
    composed: '1803-1804',
    city: 'Vienna',
    premiered: '1805, Theater an der Wien',
  },
};

const renderCard = ({ data = DATA, logger = makeLogger(), position = 0 } = {}) => {
  const props = (p) => ({
    position: p, duration: 3223, playing: true, seeking: false,
    data, region: { module: 'composer-card', width: '20%' }, logger,
  });
  const view = render(<ComposerCard {...props(position)} />);
  return { ...view, logger, at: (p) => view.rerender(<ComposerCard {...props(p)} />) };
};

const datum = (container, label) => {
  const dt = [...container.querySelectorAll('.surround-composer-card__label')]
    .find((el) => el.textContent.toLowerCase() === label.toLowerCase());
  return dt ? dt.parentElement.querySelector('.surround-composer-card__value')?.textContent : null;
};

describe('ComposerCard', () => {
  it('renders the composer identity inherited from _composer.yml', () => {
    const { getByTestId, container } = renderCard();
    expect(getByTestId('surround-composer-card')).toBeInTheDocument();
    expect(container.querySelector('.surround-composer-card__name')).toHaveTextContent('Ludwig van Beethoven');
    expect(container.querySelector('.surround-composer-card__dates')).toHaveTextContent('1770');
    expect(container.querySelector('.surround-composer-card__dates')).toHaveTextContent('1827');
    expect(container.querySelector('.surround-composer-card__birthplace'))
      .toHaveTextContent('Bonn (Electorate of Cologne)');
  });

  it('renders the piece identity beneath the brass hairline', () => {
    const { container } = renderCard();
    expect(container.querySelector('.surround-composer-card__piece-title'))
      .toHaveTextContent('Symphony No. 3 in E-flat major, "Eroica"');
    expect(datum(container, 'Opus')).toBe('Op. 55');
    expect(datum(container, 'Composed')).toBe('1803-1804');
    expect(datum(container, 'City')).toBe('Vienna');
    expect(datum(container, 'Premiered')).toBe('1805, Theater an der Wien');
  });

  it('builds the portrait URL from assetBase through the static image route', () => {
    const { getByTestId } = renderCard();
    expect(getByTestId('surround-portrait').getAttribute('src'))
      .toBe(`${window.location.origin}/api/v1/static/img/surround/classical/beethoven/portrait.jpg`);
  });

  it('hides a broken portrait without breaking the layout, and warns', () => {
    const { getByTestId, container, logger } = renderCard();
    const img = getByTestId('surround-portrait');
    fireEvent.error(img);

    expect(img.style.display).toBe('none');
    // The rest of the card is untouched.
    expect(container.querySelector('.surround-composer-card__name')).toHaveTextContent('Ludwig van Beethoven');
    expect(container.querySelector('.surround-composer-card__piece-title')).not.toBeNull();

    const warned = logger.warn.mock.calls.find((c) => c[0] === 'surround.asset.missing');
    expect(warned).toBeDefined();
    expect(warned[1]).toMatchObject({ contentId: 'plex:663134', ref: 'beethoven/portrait.jpg' });
    expect(warned[1].src).toContain('surround/classical/beethoven/portrait.jpg');
  });

  it('caps asset-missing warnings so a broken path cannot flood the log store', () => {
    const { getByTestId, logger } = renderCard();
    const img = getByTestId('surround-portrait');
    for (let i = 0; i < ASSET_WARN_PER_MINUTE + 4; i += 1) fireEvent.error(img);
    expect(logger.warn.mock.calls.filter((c) => c[0] === 'surround.asset.missing'))
      .toHaveLength(ASSET_WARN_PER_MINUTE);
  });

  it('still composes the card when the piece has no opus and no premiere', () => {
    const data = { ...DATA, piece: { title: 'Spring', composed: '1725' } };
    const { container } = renderCard({ data });
    expect(container.querySelector('.surround-composer-card__piece-title')).toHaveTextContent('Spring');
    expect(datum(container, 'Composed')).toBe('1725');
    expect(datum(container, 'Opus')).toBeNull();
    expect(datum(container, 'Premiered')).toBeNull();
    expect(datum(container, 'City')).toBeNull();
  });

  it('still composes the card when there is no portrait', () => {
    const data = { ...DATA, composer: { ...DATA.composer, portrait: undefined } };
    const { container, queryByTestId } = renderCard({ data });
    expect(queryByTestId('surround-portrait')).toBeNull();
    expect(container.querySelector('.surround-composer-card__name')).toHaveTextContent('Ludwig van Beethoven');
    expect(container.querySelector('.surround-composer-card__piece-title')).not.toBeNull();
  });

  it('omits the portrait when the payload names no assetBase', () => {
    const data = { ...DATA, assetBase: undefined };
    const { queryByTestId, container } = renderCard({ data });
    expect(queryByTestId('surround-portrait')).toBeNull();
    expect(container.querySelector('.surround-composer-card__name')).not.toBeNull();
  });

  it('reads a life span with only a birth year as an open one', () => {
    const data = { ...DATA, composer: { ...DATA.composer, died: undefined } };
    const { container } = renderCard({ data });
    expect(container.querySelector('.surround-composer-card__dates').textContent).toContain('1770');
    expect(container.querySelector('.surround-composer-card__dates').textContent).not.toContain('1827');
  });

  it('omits the dates line entirely when neither year is known', () => {
    const data = { ...DATA, composer: { name: 'Anon.' } };
    const { container } = renderCard({ data });
    expect(container.querySelector('.surround-composer-card__dates')).toBeNull();
    expect(container.querySelector('.surround-composer-card__name')).toHaveTextContent('Anon.');
  });

  it('renders the piece alone when no composer block was authored', () => {
    const data = { ...DATA, composer: undefined };
    const { container } = renderCard({ data });
    expect(container.querySelector('.surround-composer-card__name')).toBeNull();
    expect(container.querySelector('.surround-composer-card__piece-title')).toHaveTextContent('Symphony No. 3');
  });

  it('renders an empty card, without throwing, when the payload is missing', () => {
    let view;
    expect(() => { view = renderCard({ data: null }); }).not.toThrow();
    expect(view.getByTestId('surround-composer-card')).toBeInTheDocument();
  });

  it('is position-independent — the clock never changes what it renders', () => {
    const view = renderCard({ position: 0 });
    const before = view.container.innerHTML;
    view.at(2999);
    expect(view.container.innerHTML).toBe(before);
  });
});
