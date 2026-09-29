import React from 'react';
import { api } from '../../services/api';

// Catches render errors, reports them to the backend and shows a recovery UI
// instead of a blank screen.
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    api.system.reportError({ message: error.message, stack: `${error.stack}\n${info.componentStack}`.slice(0, 2000), url: window.location.pathname, component: 'ErrorBoundary' });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className={`flex flex-col items-center justify-center text-center px-6 ${this.props.fullPage ? 'min-h-screen bg-background' : 'py-20'}`}>
        <span className="material-symbols-outlined text-[28px] text-red-400 mb-3" aria-hidden="true">report</span>
        <p className="text-[15px] font-semibold text-text-primary">Algo deu errado nesta tela</p>
        <p className="text-[12px] text-text-secondary mt-1 max-w-md">O erro foi registrado automaticamente. Você pode tentar novamente sem perder o restante da sessão.</p>
        <div className="flex gap-2 mt-5">
          <button type="button" onClick={() => this.setState({ error: null })} className="h-8 px-3 rounded-lg bg-surface-card border border-border text-[12px] text-text-primary hover:bg-surface-hover">Tentar novamente</button>
          <button type="button" onClick={() => { window.location.href = '/dashboard'; }} className="h-8 px-3 rounded-lg bg-inverse text-inverse-text text-[12px] font-semibold">Ir para o dashboard</button>
        </div>
      </div>
    );
  }
}
