import { useState, useEffect } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import './Reader.scss';

export default function Reader() {
  const [feeds, setFeeds] = useState([]);
  const [selectedFeed, setSelectedFeed] = useState(null);
  const [articles, setArticles] = useState([]);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const init = async () => {
      try {
        const subs = await DaylightAPI('/api/v1/feed/reader/feeds');
        setFeeds(subs || []);
      } catch (err) {
        console.error('Failed to load feeds:', err);
        setError('Could not connect to FreshRSS. Make sure it is running and accessible.');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const loadArticles = async (feedId) => {
    setSelectedFeed(feedId);
    setSelectedArticle(null);
    try {
      const items = await DaylightAPI(`/api/v1/feed/reader/items?feed=${encodeURIComponent(feedId)}&excludeRead=true`);
      setArticles(items || []);
    } catch (err) {
      console.error('Failed to load articles:', err);
      setArticles([]);
    }
  };

  const selectArticle = async (article) => {
    setSelectedArticle(article);
    try {
      await DaylightAPI('/api/v1/feed/reader/items/mark', { itemIds: [article.id], action: 'read' }, 'POST');
    } catch (err) {
      console.error('Failed to mark read:', err);
    }
  };

  if (loading) return <div className="feed-placeholder">Loading feeds...</div>;
  if (error) return <div className="feed-placeholder">{error}</div>;

  return (
    <div className="reader-view">
      <div className="reader-sidebar">
        <h4 className="reader-sidebar-title">Feeds</h4>
        {feeds.map(feed => (
          <button
            key={feed.id}
            className={`reader-feed-item ${selectedFeed === feed.id ? 'active' : ''}`}
            onClick={() => loadArticles(feed.id)}
          >
            {feed.title}
          </button>
        ))}
        {feeds.length === 0 && (
          <div className="reader-empty">No FreshRSS feeds found</div>
        )}
      </div>

      <div className="reader-articles">
        {selectedFeed ? (
          articles.length > 0 ? (
            articles.map((article, i) => (
              <button
                key={article.id || i}
                className={`reader-article-item ${selectedArticle?.id === article.id ? 'active' : ''}`}
                onClick={() => selectArticle(article)}
              >
                <span className="reader-article-title">{article.title}</span>
                <span className="reader-article-meta">
                  {article.author && `${article.author} \u00b7 `}
                  {article.published && new Date(article.published).toLocaleDateString()}
                </span>
              </button>
            ))
          ) : (
            <div className="reader-empty">No unread articles</div>
          )
        ) : (
          <div className="reader-empty">Select a feed</div>
        )}
      </div>

      <div className="reader-content">
        {selectedArticle ? (
          <>
            <h2 className="reader-content-title">{selectedArticle.title}</h2>
            <div className="reader-content-meta">
              {selectedArticle.feedTitle && <span>{selectedArticle.feedTitle}</span>}
              {selectedArticle.author && <span> &middot; {selectedArticle.author}</span>}
              {selectedArticle.published && (
                <span> &middot; {new Date(selectedArticle.published).toLocaleString()}</span>
              )}
            </div>
            <div
              className="reader-content-body"
              dangerouslySetInnerHTML={{ __html: selectedArticle.content }}
            />
            {selectedArticle.link && (
              <a
                className="reader-content-link"
                href={selectedArticle.link}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open original
              </a>
            )}
          </>
        ) : (
          <div className="reader-empty">Select an article to read</div>
        )}
      </div>
    </div>
  );
}
