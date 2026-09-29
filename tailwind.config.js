/** @type {import('tailwindcss').Config} */
// Colors are CSS variables (RGB channels) defined in src/index.css so the
// same classes render the dark identity by default and a light theme on demand.
const token = name => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: token('bg'),
        'background-secondary': token('bg-secondary'),
        surface: token('surface'),
        'surface-card': token('surface-card'),
        'surface-elevated': token('surface-elevated'),
        'surface-hover': token('surface-hover'),
        border: token('border'),
        'border-subtle': token('border-subtle'),
        'border-focus': token('border-focus'),
        'text-primary': token('text-primary'),
        'text-secondary': token('text-secondary'),
        'text-muted': token('text-muted'),
        inverse: token('inverse'),
        'inverse-text': token('inverse-text'),
        urgent: '#EF4444',
        high: '#F59E0B',
        normal: '#3B82F6',
        completed: '#10B981'
      },
      fontFamily: {
        sans: ['Inter Variable', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace']
      },
      fontSize: {
        'title-xl': ['28px', { lineHeight: '36px', letterSpacing: '-0.025em', fontWeight: '600' }],
        'title-lg': ['24px', { lineHeight: '32px', letterSpacing: '-0.02em', fontWeight: '600' }],
        'title-md': ['18px', { lineHeight: '26px', letterSpacing: '-0.015em', fontWeight: '600' }],
        'title-sm': ['15px', { lineHeight: '22px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'body-lg': ['15px', { lineHeight: '24px', letterSpacing: '-0.01em', fontWeight: '400' }],
        'body-md': ['13px', { lineHeight: '20px', letterSpacing: '-0.005em', fontWeight: '400' }],
        'body-sm': ['12px', { lineHeight: '18px', letterSpacing: '0em', fontWeight: '400' }],
        'label-md': ['13px', { lineHeight: '18px', letterSpacing: '-0.005em', fontWeight: '500' }],
        'label-sm': ['11px', { lineHeight: '16px', letterSpacing: '0.02em', fontWeight: '500' }],
        'mono-data': ['12px', { lineHeight: '18px', letterSpacing: '-0.01em', fontWeight: '400' }],
        'mono-kbd': ['10px', { lineHeight: '14px', letterSpacing: '0.02em', fontWeight: '500' }]
      },
      boxShadow: {
        elevated: '0 4px 24px rgb(var(--shadow) / 0.45)',
        modal: '0 16px 48px rgb(var(--shadow) / 0.7)'
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        slideInRight: { '0%': { opacity: '0', transform: 'translateX(24px)' }, '100%': { opacity: '1', transform: 'translateX(0)' } },
        slideInLeft: { '0%': { opacity: '0', transform: 'translateX(-24px)' }, '100%': { opacity: '1', transform: 'translateX(0)' } },
        slideUp: { '0%': { opacity: '0', transform: 'translateY(12px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        scaleIn: { '0%': { opacity: '0', transform: 'scale(0.96)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } }
      },
      animation: {
        fadeIn: 'fadeIn 240ms cubic-bezier(0.16, 1, 0.3, 1) both',
        slideInRight: 'slideInRight 280ms cubic-bezier(0.16, 1, 0.3, 1) both',
        slideInLeft: 'slideInLeft 280ms cubic-bezier(0.16, 1, 0.3, 1) both',
        slideUp: 'slideUp 240ms cubic-bezier(0.16, 1, 0.3, 1) both',
        scaleIn: 'scaleIn 200ms cubic-bezier(0.16, 1, 0.3, 1) both',
        shimmer: 'shimmer 2s linear infinite'
      }
    }
  },
  plugins: []
};
