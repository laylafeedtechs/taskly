import React from 'react';

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon = null,
  iconRight = null,
  kbd = null,
  className = '',
  disabled = false,
  onClick,
  type = 'button',
  ...props
}) {
  const baseStyles = 'inline-flex items-center justify-center font-medium rounded transition-colors select-none focus:outline-none focus:ring-1 focus:ring-border-focus disabled:opacity-50 disabled:pointer-events-none cursor-pointer';

  const variantStyles = {
    primary: 'bg-white text-[#080808] hover:bg-[#E5E5E5] active:bg-[#CCCCCC] font-medium shadow-sm',
    secondary: 'bg-surface-card text-text-primary border border-border hover:bg-surface-hover hover:border-border-focus active:bg-surface-elevated',
    subtle: 'bg-surface text-text-secondary border border-border-subtle hover:text-text-primary hover:bg-surface-elevated',
    ghost: 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-surface-hover',
    destructive: 'bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25',
    accent: 'bg-blue-600 text-white hover:bg-blue-500 active:bg-blue-700'
  };

  const sizeStyles = {
    xs: 'h-6 px-2 text-[11px] gap-1',
    sm: 'h-7 px-2.5 text-[12px] gap-1.5',
    md: 'h-8 px-3 text-[13px] gap-2',
    lg: 'h-10 px-4 text-[14px] gap-2.5',
    icon: 'h-8 w-8 p-0'
  };

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {icon && (
        <span className="material-symbols-outlined text-[16px] leading-none">
          {icon}
        </span>
      )}
      {children}
      {iconRight && (
        <span className="material-symbols-outlined text-[16px] leading-none">
          {iconRight}
        </span>
      )}
      {kbd && (
        <kbd className="ml-1.5 px-1 py-0.2 text-[10px] font-mono rounded bg-black/30 border border-white/20 text-inherit">
          {kbd}
        </kbd>
      )}
    </button>
  );
}
