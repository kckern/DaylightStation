import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import DetailView from "./DetailView.jsx";

vi.mock("../../Annotations/AnnotationPanel.jsx", () => ({ default: () => <div>Annotations</div> }));
vi.mock("../../offline/OfflineEditionButton.jsx", () => ({ default: () => <button>Download</button> }));
vi.mock("./sections/index.jsx", () => ({ renderSection: () => null }));

const article = {
  id: 'story',
  title: 'Blocked publisher story',
  source: 'News',
  link: 'https://news.example/story',
  state: {},
};

describe('DetailView recovery and navigation', () => {
  beforeAll(() => {
    HTMLElement.prototype.getAnimations = () => [];
    HTMLElement.prototype.animate = () => ({ onfinish: null });
  });
  test('keeps an original-link escape hatch beside the iframe fallback', () => {
    render(<DetailView item={article} sections={[]} loading={false} onBack={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Open in browser' })).toHaveAttribute('href', article.link);
    expect(screen.getByTitle(article.title)).toHaveAttribute('src', article.link);
    expect(screen.getByText(/publisher blocks the embedded page/i)).toBeInTheDocument();
  });

  test('renders a non-web link as plain text: no anchor, no iframe', () => {
    for (const link of ['javascript:alert(1)', 'data:text/html,<script>1</script>', '/api/v1/admin/ws/restart']) {
      const { unmount, container } = render(<DetailView item={{ ...article, link }} sections={[]} loading={false} onBack={vi.fn()} />);
      expect(screen.queryByRole('link', { name: 'Open in browser' }), link).toBeNull();
      expect(container.querySelector('iframe'), link).toBeNull();
      expect(screen.getByText(link)).toBeInTheDocument();
      unmount();
    }
  });

  test('never frames a link on the app\'s own origin (scripts + same-origin would escape the sandbox)', () => {
    const link = `${window.location.origin}/admin`;
    const { container } = render(<DetailView item={{ ...article, link }} sections={[]} loading={false} onBack={vi.fn()} />);
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('link', { name: 'Open in browser' })).toHaveAttribute('href', link);
  });

  test('checks the paywall-proxied URL, not just the link', () => {
    const item = { ...article, meta: { paywall: true, paywallProxy: 'javascript:alert(1)//' } };
    const { container } = render(<DetailView item={item} sections={[]} loading={false} onBack={vi.fn()} />);
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open via archive' })).toBeNull();
  });

  test('shows a recoverable reader error and explicit previous/next controls', () => {
    const onRetry = vi.fn();
    const onNext = vi.fn();
    render(<DetailView item={{ ...article, link: null }} sections={[]} loading={false} error="Reader failed." onRetry={onRetry} onBack={vi.fn()} onNext={onNext} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try reader view again' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  test('falls back to a YouTube embed when loading finishes without sections', () => {
    const video = { ...article, id: 'youtube:abc', title: 'Video', contentType: 'youtube', meta: { videoId: 'abc' } };
    render(<DetailView item={video} sections={[]} loading={false} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
    expect(screen.getByTitle('Video')).toHaveAttribute('src', expect.stringContaining('youtube.com/embed/abc'));
  });
});
