import PropTypes from 'prop-types';
import './ProgressFrame.scss';

const ProgressFrame = ({ leftPct, widthPct }) => (
  <div
    className="progress-zoom-window"
    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
  />
);

ProgressFrame.propTypes = {
  leftPct: PropTypes.number.isRequired,
  widthPct: PropTypes.number.isRequired
};

export default ProgressFrame;
