import React from 'react';

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
          {rest.map(photo => (
            <div key={photo.id} className="photo-thumb">
              <img src={photo.thumbnail} alt="" loading="lazy" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="photo-wall">
      {photos.map(photo => (
        <div key={photo.id} className="photo-thumb">
          <img src={photo.thumbnail} alt="" loading="lazy" />
        </div>
      ))}
    </div>
  );
}
