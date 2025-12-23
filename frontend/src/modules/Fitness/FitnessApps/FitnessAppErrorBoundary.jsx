import React from 'react';

class FitnessAppErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  
  componentDidCatch(error, errorInfo) {
    const { appId, sessionInstance } = this.props;
    
    // Log to session
    sessionInstance?.logEvent?.('app_error', {
      appId,
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack
    });
    
    console.error(`Fitness App Error [${appId}]:`, error, errorInfo);
  }
  
  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };
  
  render() {
    if (this.state.hasError) {
      return (
        <div className="fitness-app-error" style={{ 
          padding: '20px', 
          textAlign: 'center', 
          color: 'white',
          background: 'rgba(255,0,0,0.1)',
          borderRadius: '8px',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center'
        }}>
          <div className="error-icon" style={{ fontSize: '32px', marginBottom: '16px' }}>⚠️</div>
          <div className="error-title" style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px' }}>App Error</div>
          <div className="error-message" style={{ marginBottom: '24px', opacity: 0.8 }}>
            {this.props.manifest?.name || 'This app'} encountered an error.
          </div>
          <div className="error-actions" style={{ display: 'flex', gap: '12px' }}>
            <button onClick={this.handleRetry} style={{
              padding: '8px 16px',
              background: 'var(--fitness-accent-color, #00d1b2)',
              border: 'none',
              borderRadius: '4px',
              color: 'white',
              cursor: 'pointer'
            }}>Retry</button>
            <button onClick={this.props.onClose} style={{
              padding: '8px 16px',
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              borderRadius: '4px',
              color: 'white',
              cursor: 'pointer'
            }}>Close</button>
          </div>
        </div>
      );
    }
    
    return this.props.children;
  }
}

export default FitnessAppErrorBoundary;
