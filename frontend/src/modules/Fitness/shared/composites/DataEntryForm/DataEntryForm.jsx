import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { AppButton, NumericKeypad, TouchSlider } from '../../primitives';
import { MultiChoice } from '../MultiChoice';
import './DataEntryForm.scss';

const DataEntryForm = ({
  fields = [],
  initialValues = {},
  onSubmit,
  onCancel,
  submitLabel = 'Save',
  cancelLabel = 'Cancel',
  className,
  ...props
}) => {
  const [values, setValues] = useState(initialValues);
  const [activeField, setActiveField] = useState(fields[0]?.name);

  const handleChange = (name, value) => {
    setValues(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e) => {
    e?.preventDefault();
    onSubmit(values);
  };

  const renderFieldInput = (field) => {
    const value = values[field.name] !== undefined ? values[field.name] : '';

    switch (field.type) {
      case 'number':
        return (
          <div className="data-entry-form__keypad-wrapper">
            <div className="data-entry-form__value-display">
              {value} {field.unit}
            </div>
            <NumericKeypad
              value={String(value)}
              onChange={(val) => handleChange(field.name, val)}
              label={field.label}
              unit={field.unit}
              {...field.props}
            />
          </div>
        );
      
      case 'slider':
        return (
          <div className="data-entry-form__slider-wrapper">
            <TouchSlider
              value={Number(value) || field.min || 0}
              onChange={(val) => handleChange(field.name, val)}
              label={field.label}
              min={field.min}
              max={field.max}
              step={field.step}
              showValue
              {...field.props}
            />
          </div>
        );

      case 'select':
      case 'multiselect':
        return (
          <MultiChoice
            options={field.options}
            value={value}
            onChange={(val) => handleChange(field.name, val)}
            multiSelect={field.type === 'multiselect'}
            {...field.props}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div className={`data-entry-form ${className || ''}`} {...props}>
      <div className="data-entry-form__fields">
        {fields.length > 1 ? (
          // Tabbed interface for multiple fields
          <div className="data-entry-form__tabs">
            <div className="data-entry-form__tab-headers">
              {fields.map(field => (
                <button
                  key={field.name}
                  className={`data-entry-form__tab-btn ${activeField === field.name ? 'active' : ''}`}
                  onClick={() => setActiveField(field.name)}
                >
                  {field.label}
                  {values[field.name] && <span className="data-entry-form__tab-value"> • {values[field.name]}</span>}
                </button>
              ))}
            </div>
            <div className="data-entry-form__tab-content">
              {renderFieldInput(fields.find(f => f.name === activeField))}
            </div>
          </div>
        ) : (
          // Single field view
          <div className="data-entry-form__single-field">
            {renderFieldInput(fields[0])}
          </div>
        )}
      </div>

      <div className="data-entry-form__actions">
        {onCancel && (
          <AppButton variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </AppButton>
        )}
        <AppButton variant="primary" onClick={handleSubmit}>
          {submitLabel}
        </AppButton>
      </div>
    </div>
  );
};

DataEntryForm.propTypes = {
  fields: PropTypes.arrayOf(PropTypes.shape({
    name: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    type: PropTypes.oneOf(['number', 'slider', 'select', 'multiselect']).isRequired,
    unit: PropTypes.string,
    options: PropTypes.array,
    min: PropTypes.number,
    max: PropTypes.number,
    step: PropTypes.number,
    props: PropTypes.object
  })).isRequired,
  initialValues: PropTypes.object,
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func,
  submitLabel: PropTypes.node,
  cancelLabel: PropTypes.node,
  className: PropTypes.string
};

export default DataEntryForm;
