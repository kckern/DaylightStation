import React from 'react';
import PropTypes from 'prop-types';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import './ChartWidget.scss';

const ChartWidget = ({
  data = [],
  type = 'line',
  dataKey = 'value',
  xAxisKey = 'name',
  color = 'var(--app-action-primary)',
  height = 200,
  showGrid = true,
  showXAxis = true,
  showYAxis = true,
  showTooltip = true,
  title,
  className,
  ...props
}) => {
  const renderChart = () => {
    const commonProps = {
      data,
      margin: { top: 5, right: 5, bottom: 5, left: -20 }
    };

    switch (type) {
      case 'area':
        return (
          <AreaChart {...commonProps}>
            {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />}
            {showXAxis && <XAxis dataKey={xAxisKey} stroke="rgba(255,255,255,0.5)" fontSize={10} tickLine={false} />}
            {showYAxis && <YAxis stroke="rgba(255,255,255,0.5)" fontSize={10} tickLine={false} />}
            {showTooltip && (
              <Tooltip 
                contentStyle={{ backgroundColor: '#333', border: 'none', borderRadius: '4px' }}
                itemStyle={{ color: '#fff' }}
              />
            )}
            <Area 
              type="monotone" 
              dataKey={dataKey} 
              stroke={color} 
              fill={color} 
              fillOpacity={0.3} 
            />
          </AreaChart>
        );
      
      case 'bar':
        return (
          <BarChart {...commonProps}>
            {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />}
            {showXAxis && <XAxis dataKey={xAxisKey} stroke="rgba(255,255,255,0.5)" fontSize={10} tickLine={false} />}
            {showYAxis && <YAxis stroke="rgba(255,255,255,0.5)" fontSize={10} tickLine={false} />}
            {showTooltip && (
              <Tooltip 
                contentStyle={{ backgroundColor: '#333', border: 'none', borderRadius: '4px' }}
                itemStyle={{ color: '#fff' }}
                cursor={{ fill: 'rgba(255,255,255,0.1)' }}
              />
            )}
            <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} />
          </BarChart>
        );

      case 'line':
      default:
        return (
          <LineChart {...commonProps}>
            {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />}
            {showXAxis && <XAxis dataKey={xAxisKey} stroke="rgba(255,255,255,0.5)" fontSize={10} tickLine={false} />}
            {showYAxis && <YAxis stroke="rgba(255,255,255,0.5)" fontSize={10} tickLine={false} />}
            {showTooltip && (
              <Tooltip 
                contentStyle={{ backgroundColor: '#333', border: 'none', borderRadius: '4px' }}
                itemStyle={{ color: '#fff' }}
              />
            )}
            <Line 
              type="monotone" 
              dataKey={dataKey} 
              stroke={color} 
              strokeWidth={2} 
              dot={false} 
              activeDot={{ r: 4 }} 
            />
          </LineChart>
        );
    }
  };

  return (
    <div className={`chart-widget ${className || ''}`} {...props}>
      {title && <div className="chart-widget__title">{title}</div>}
      <div className="chart-widget__container" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      </div>
    </div>
  );
};

ChartWidget.propTypes = {
  data: PropTypes.array.isRequired,
  type: PropTypes.oneOf(['line', 'area', 'bar']),
  dataKey: PropTypes.string,
  xAxisKey: PropTypes.string,
  color: PropTypes.string,
  height: PropTypes.number,
  showGrid: PropTypes.bool,
  showXAxis: PropTypes.bool,
  showYAxis: PropTypes.bool,
  showTooltip: PropTypes.bool,
  title: PropTypes.node,
  className: PropTypes.string
};

export default ChartWidget;
