import React from 'react';

export function MetricCard({ title, value, subtext, trend, icon, sparkline, alert }) {
  return (
    <div className="bg-surface-card p-4 rounded-lg border border-border flex flex-col justify-between shadow-sm relative overflow-hidden group hover:border-border-focus transition-colors">
      <div className="flex items-start justify-between">
        <span className="font-mono text-mono-data uppercase tracking-wider text-text-muted">{title}</span>
        {trend && (
          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded font-mono text-[11px] ${
            trend.positive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
          }`}>
            <span className="material-symbols-outlined text-[12px]">
              {trend.positive ? 'arrow_upward' : 'arrow_downward'}
            </span>
            <span>{trend.value}</span>
          </span>
        )}
        {alert && (
          <span className="px-2 py-0.5 rounded bg-surface-elevated text-text-primary font-mono text-[11px] border border-border">
            {alert}
          </span>
        )}
      </div>

      <div className="flex items-end justify-between mt-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[26px] font-semibold text-text-primary leading-none font-tabular">{value}</span>
          {subtext && <span className="font-mono text-[12px] text-text-muted">{subtext}</span>}
        </div>

        {sparkline && (
          <div className="w-20 h-6">
            <svg className="w-full h-full text-blue-400" fill="none" viewBox="0 0 80 24">
              <path d="M0 18 L15 14 L30 19 L45 8 L60 12 L75 4 L80 6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
              <path d="M0 18 L15 14 L30 19 L45 8 L60 12 L75 4 L80 6 V24 H0 Z" fill="currentColor" fillOpacity="0.1" />
            </svg>
          </div>
        )}

        {icon && (
          <span className="material-symbols-outlined text-text-muted text-[22px] group-hover:text-text-primary transition-colors">
            {icon}
          </span>
        )}
      </div>
    </div>
  );
}

export function Modal({ isOpen, onClose, title, subtitle, children, maxWidth = 'max-w-lg' }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div 
        className="fixed inset-0"
        onClick={onClose}
      ></div>
      <div className={`relative bg-surface border border-border-focus rounded-xl shadow-modal w-full ${maxWidth} overflow-hidden z-10 animate-scaleUp`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-surface-card/60">
          <div>
            <h3 className="text-[16px] font-semibold text-text-primary">{title}</h3>
            {subtitle && <p className="text-[12px] text-text-secondary mt-0.5">{subtitle}</p>}
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
        <div className="p-5 max-h-[80vh] overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

export function Drawer({ isOpen, onClose, title, children, width = 'w-[480px]' }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      ></div>
      <div className={`fixed inset-y-0 right-0 ${width} max-w-full bg-surface border-l border-border shadow-2xl flex flex-col z-10 transform transition-transform duration-200 ease-out`}>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ icon = 'inbox', title, description, actionText, onAction }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed border-border rounded-xl bg-surface/30">
      <div className="w-12 h-12 rounded-full bg-surface-elevated border border-border flex items-center justify-center text-text-muted mb-4">
        <span className="material-symbols-outlined text-[24px]">{icon}</span>
      </div>
      <h3 className="text-[15px] font-semibold text-text-primary">{title}</h3>
      <p className="text-[13px] text-text-secondary max-w-sm mt-1 mb-5">{description}</p>
      {actionText && onAction && (
        <button
          onClick={onAction}
          className="h-8 px-3 rounded bg-white text-black hover:bg-gray-200 text-[13px] font-medium transition-colors shadow-sm inline-flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          <span>{actionText}</span>
        </button>
      )}
    </div>
  );
}
