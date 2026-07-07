import { Component } from 'react';
import { Button } from '@mantine/core';
import { getChildLogger } from '../../lib/logging/singleton.js';

const financeLogger = getChildLogger({ app: 'finance' });

/** A render crash in one block must not blank its neighbors (audit 5.2). */
export class FinanceErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    financeLogger.error('finance.render.crash', {
      block: this.props.label || 'dashboard',
      error: String(error),
      stack: info?.componentStack
    });
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ margin: '1rem', padding: '1rem', border: '1px solid #c00', borderRadius: 8, background: '#fee', color: '#600' }}>
          <strong>{this.props.label || 'Finance dashboard'} crashed.</strong>
          <div style={{ margin: '0.5rem 0', fontSize: '0.9em' }}>{String(this.state.error?.message || this.state.error)}</div>
          <Button onClick={() => this.setState({ error: null })} variant="outline" color="red" size="xs">Retry render</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
