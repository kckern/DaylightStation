import React from 'react';
import PropTypes from 'prop-types';
import './SplitViewContainer.scss';

const SplitViewContainer = ({
  left,
  right,
  split = '50-50',
  orientation = 'horizontal',
  showDivider = true,
  className,
  ...props
}) => {
  const combinedClassName = [
    'split-view-container',
    `split-view-container--${orientation}`,
    `split-view-container--split-${split}`,
    className
  ].filter(Boolean).join(' ');

  return (
    <div className={combinedClassName} {...props}>
      <div className="split-view-container__pane split-view-container__pane--left">
        {left}
      </div>
      {showDivider && <div className="split-view-container__divider" />}
      <div className="split-view-container__pane split-view-container__pane--right">
        {right}
      </div>
    </div>
  );
};

SplitViewContainer.propTypes = {
  left: PropTypes.node.isRequired,
  right: PropTypes.node.isRequired,
  split: PropTypes.oneOf(['50-50', '30-70', '70-30', '40-60', '60-40']),
  orientation: PropTypes.oneOf(['horizontal', 'vertical']),
  showDivider: PropTypes.bool,
  className: PropTypes.string
};

export default SplitViewContainer;
