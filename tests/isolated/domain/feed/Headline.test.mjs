import { Headline } from '#domains/feed/entities/Headline.mjs';

describe('Headline', () => {
  const validData = {
    source: 'cnn',
    title: 'Breaking: Something happened',
    desc: 'Officials confirmed today that the situation has developed...',
    link: 'https://cnn.com/article/123',
    timestamp: new Date('2026-02-15T09:45:00Z'),
  };

  test('creates from valid data', () => {
    const headline = new Headline(validData);
    expect(headline.source).toBe('cnn');
    expect(headline.title).toBe('Breaking: Something happened');
    expect(headline.desc).toBe('Officials confirmed today that the situation has developed...');
    expect(headline.link).toBe('https://cnn.com/article/123');
    expect(headline.timestamp).toEqual(new Date('2026-02-15T09:45:00Z'));
  });

  test('desc defaults to null', () => {
    const { desc, ...noDesc } = validData;
    const headline = new Headline(noDesc);
    expect(headline.desc).toBeNull();
  });

  test('truncateDesc truncates long descriptions', () => {
    const longDesc = 'A'.repeat(200);
    const headline = new Headline({ ...validData, desc: longDesc });
    const truncated = headline.truncateDesc(120);
    expect(truncated.length).toBeLessThanOrEqual(123); // 120 + '...'
    expect(truncated.endsWith('...')).toBe(true);
  });

  test('truncateDesc returns short desc as-is', () => {
    const headline = new Headline({ ...validData, desc: 'Short' });
    expect(headline.truncateDesc(120)).toBe('Short');
  });

  test('toJSON serializes correctly', () => {
    const headline = new Headline(validData);
    const json = headline.toJSON();
    expect(json).toEqual({
      source: 'cnn',
      title: 'Breaking: Something happened',
      desc: 'Officials confirmed today that the situation has developed...',
      link: 'https://cnn.com/article/123',
      timestamp: '2026-02-15T09:45:00.000Z',
    });
  });

  test('fromJSON roundtrips', () => {
    const headline = new Headline(validData);
    const restored = Headline.fromJSON(headline.toJSON());
    expect(restored.source).toBe(headline.source);
    expect(restored.title).toBe(headline.title);
    expect(restored.link).toBe(headline.link);
  });

  test('throws on missing source', () => {
    const { source, ...noSource } = validData;
    expect(() => new Headline(noSource)).toThrow();
  });

  test('throws on missing title', () => {
    const { title, ...noTitle } = validData;
    expect(() => new Headline(noTitle)).toThrow();
  });

  test('throws on missing link', () => {
    const { link, ...noLink } = validData;
    expect(() => new Headline(noLink)).toThrow();
  });
});
