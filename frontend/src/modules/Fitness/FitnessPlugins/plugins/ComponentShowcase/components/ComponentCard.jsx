import React from 'react';

const ComponentCard = ({ title, description, badge, children, footer }) => {
  return (
    <div className="cs-demo-card">
      <div className="cs-demo-card__head">
        <div>
          <p className="cs-card-kicker">Primitive</p>
          <h4 className="cs-demo-card__title">{title}</h4>
          {description && <p className="cs-demo-card__desc">{description}</p>}
        </div>
        {badge && <span className="cs-chip">{badge}</span>}
      </div>
      <div className="cs-demo-card__body">{children}</div>
      {footer && <div className="cs-demo-card__foot">{footer}</div>}
    </div>
  );
};

export default ComponentCard;
