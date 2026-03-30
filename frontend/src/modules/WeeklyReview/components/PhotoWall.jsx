import React from 'react';

function MediaThumb({ photo }) {
  return (
    <div className={`photo-thumb${photo.type === 'video' ? ' photo-thumb--video' : ''}`}>
      <img src={photo.thumbnail} alt="" loading="lazy" />
      {photo.type === 'video' && <span className="video-badge">▶</span>}
    </div>
  );
}

export default function PhotoWall({ photos }) {
  if (!photos || photos.length === 0) {
    return <div className="photo-wall-empty">—</div>;
  }

  const hero = photos.find(p => p.isHero);
  const rest = photos.filter(p => !p.isHero);

  if (hero) {
    return (
      <div className="photo-wall photo-wall--with-hero">
        <div className="photo-hero">
          <img src={hero.thumbnail} alt="" loading="lazy" />
          {hero.people.length > 0 && (
            <div className="photo-people">{hero.people.join(', ')}</div>
          )}
        </div>
        <div className="photo-thumbs">
          {rest.map(photo => <MediaThumb key={photo.id} photo={photo} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="photo-wall">
      {photos.map(photo => <MediaThumb key={photo.id} photo={photo} />)}
    </div>
  );
}
