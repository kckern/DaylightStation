import React from 'react';

export class OptionalRendererBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { this.props.onFailure?.({ renderer: this.props.rendererId || 'unknown', error }); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
