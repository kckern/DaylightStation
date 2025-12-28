/**
 * PoseInspector - Debug tool to inspect raw keypoint data
 */

import React from 'react';

const PoseInspector = ({ pose, onClose }) => {
  if (!pose) {
    return (
      <div className="pose-inspector">
        <div className="inspector-header">
          <h3>Pose Inspector</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="inspector-content empty">
          No pose detected
        </div>
      </div>
    );
  }

  return (
    <div className="pose-inspector">
      <div className="inspector-header">
        <h3>Pose Inspector</h3>
        <button className="close-btn" onClick={onClose}>×</button>
      </div>
      <div className="inspector-content">
        <div className="inspector-summary">
          <div>Score: {(pose.score * 100).toFixed(1)}%</div>
          <div>Keypoints: {pose.keypoints.length}</div>
        </div>
        <div className="keypoints-list">
          {pose.keypoints.map((kp, i) => (
            <div key={i} className="keypoint-row">
              <span className="kp-index">{i}</span>
              <span className="kp-name">{kp.name || 'unknown'}</span>
              <div className="kp-coords">
                <span title="x">x:{kp.x.toFixed(0)}</span>
                <span title="y">y:{kp.y.toFixed(0)}</span>
                <span title="z">z:{kp.z?.toFixed(1) || '-'}</span>
              </div>
              <span className={`kp-score ${kp.score > 0.5 ? 'good' : 'bad'}`}>
                {(kp.score * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PoseInspector;
