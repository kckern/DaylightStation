/**
 * Keep-alive driver — a single low-contrast dot crawling the header's top border.
 *
 * History: this used to render THREE overlapping drivers (a muted <video>, a CSS
 * box, and a 30Hz canvas) parked in the header band to fight the SM-T590 WebView's
 * vsync/BeginFrame stall. They were visually intrusive (dark boxes over the
 * breadcrumb) and did not reliably prevent the jank, so per direction they're
 * consolidated to this one minimal driver: a ~1px dot animated across the full
 * viewport width. The translateX runs on the compositor thread, so the page keeps
 * presenting a frame each vsync — while reading as an intentional accent on the
 * top border rather than a bug. See `.piano-keepalive-crawl` in PianoApp.scss.
 */
export default function KeepAliveVideo() {
  return <div className="piano-keepalive-crawl" aria-hidden="true" />;
}
