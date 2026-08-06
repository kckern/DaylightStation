/**
 * TabErrorBoundary — one bad field must never blank the whole console (the
 * M4 live incident: an object rendered as a JSX child unmounted every tab).
 * Scoped per tab: the other three tabs and the shell stay alive.
 */
import { Component } from 'react';
import { teacherLog } from './teacherLog.js';

export default class TabErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error) {
    teacherLog.fetchError('tab-render-crashed', { tab: this.props.tab, error: error?.message });
  }

  componentDidUpdate(prev) {
    if (this.state.failed && (prev.tab !== this.props.tab || prev.resetKey !== this.props.resetKey)) {
      // A new tab or learner is a fresh start — don't trap the user in the
      // crash card for content that might render fine.
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <p className="teacher-panel__error">
          This tab hit a rendering error — the rest of the console is unaffected. Switch tabs or reload.
        </p>
      );
    }
    return this.props.children;
  }
}
