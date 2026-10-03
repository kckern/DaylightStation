// frontend/src/modules/Media/browse/HomeTile.jsx
// One item on the start page: picture, title, up to two plain lines (where it
// played, how far in), an optional inline Play / Continue button (R8) and the
// ⋯ menu with every verb. The picture follows the tap rule it is given.
import React from 'react';
import { Button, UnstyledButton } from '@mantine/core';
import { IconPlayerPlayFilled } from '@tabler/icons-react';
import { ItemMenu } from '../household/ItemMenu.jsx';

export function HomeTile({
  item, lines = [], size = 'normal', primary = null, onPicture, pictureLabel,
  onVerb, favourite, watched = null, removable = false, testId, progress = null,
}) {
  const title = item?.title ?? 'Untitled';
  return (
    <div className={`home-tile home-tile--${size}`} data-testid={testId}>
      <UnstyledButton
        className="home-tile-picture"
        data-testid={`${testId}-picture`}
        aria-label={pictureLabel ?? title}
        onClick={onPicture}
      >
        {item?.thumbnail
          ? <img src={item.thumbnail} alt="" loading="lazy" />
          : <span className="home-tile-placeholder" aria-hidden>{title.slice(0, 1).toUpperCase()}</span>}
        {Number.isFinite(progress) && progress > 0 && (
          <span className="home-tile-progress" aria-hidden>
            <span className="home-tile-progress-fill" style={{ width: `${Math.min(100, Math.max(2, progress))}%` }} />
          </span>
        )}
      </UnstyledButton>
      <div className="home-tile-body">
        <span className="home-tile-title" title={title}>{title}</span>
        {lines.filter(Boolean).map((line, index) => (
          <span key={index} className="home-tile-line" data-testid={`${testId}-line-${index}`}>{line}</span>
        ))}
      </div>
      <div className="home-tile-actions">
        {primary && (
          <Button
            size="sm"
            className="home-tile-primary"
            data-testid={primary.testId ?? `${testId}-play`}
            leftSection={<IconPlayerPlayFilled size={14} aria-hidden />}
            onClick={primary.onClick}
          >
            <span className="home-tile-primary-label">{primary.label}</span>
          </Button>
        )}
        <ItemMenu item={item} onVerb={onVerb} favourite={favourite} watched={watched} removable={removable} testId={testId} />
      </div>
    </div>
  );
}

export default HomeTile;
