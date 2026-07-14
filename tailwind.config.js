/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	theme: {
		extend: {
			fontFamily: {
				sans: [
					'"Plus Jakarta Sans"',
					'ui-sans-serif',
					'system-ui',
					'-apple-system',
					'Segoe UI',
					'Roboto',
					'sans-serif'
				],
				mono: [
					'"JetBrains Mono"',
					'ui-monospace',
					'SFMono-Regular',
					'Menlo',
					'Monaco',
					'Consolas',
					'monospace'
				],
				display: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif']
			},
			fontSize: {
				'2xs': ['0.6875rem', { lineHeight: '1rem' }]
			},
			boxShadow: {
				soft: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 4px 16px -2px rgb(15 23 42 / 0.06)',
				card: '0 1px 3px 0 rgb(15 23 42 / 0.05), 0 8px 24px -6px rgb(15 23 42 / 0.08)',
				elevated: '0 4px 6px -1px rgb(15 23 42 / 0.06), 0 16px 40px -8px rgb(15 23 42 / 0.12)',
				glow: '0 0 0 3px color-mix(in oklab, var(--p) 22%, transparent)'
			},
			borderRadius: {
				'2xl': '1rem',
				'3xl': '1.25rem'
			},
			animation: {
				'fade-in': 'fadeIn 0.25s ease-out',
				'slide-up': 'slideUp 0.3s ease-out'
			},
			keyframes: {
				fadeIn: {
					'0%': { opacity: '0' },
					'100%': { opacity: '1' }
				},
				slideUp: {
					'0%': { opacity: '0', transform: 'translateY(6px)' },
					'100%': { opacity: '1', transform: 'translateY(0)' }
				}
			}
		}
	},
	plugins: [require('daisyui')],
	daisyui: {
		themes: [
			{
				ledger: {
					primary: '#0d9488',
					'primary-content': '#f0fdfa',
					secondary: '#475569',
					'secondary-content': '#f8fafc',
					accent: '#6366f1',
					'accent-content': '#eef2ff',
					neutral: '#1e293b',
					'neutral-content': '#f1f5f9',
					'base-100': '#ffffff',
					'base-200': '#f1f5f9',
					'base-300': '#e2e8f0',
					'base-content': '#0f172a',
					info: '#0ea5e9',
					'info-content': '#f0f9ff',
					success: '#10b981',
					'success-content': '#ecfdf5',
					warning: '#f59e0b',
					'warning-content': '#fffbeb',
					error: '#ef4444',
					'error-content': '#fef2f2',
					'--rounded-box': '1rem',
					'--rounded-btn': '0.75rem',
					'--rounded-badge': '9999px',
					'--animation-btn': '0.2s',
					'--animation-input': '0.2s',
					'--btn-focus-scale': '0.98',
					'--border-btn': '1.5px',
					'--tab-border': '1.5px',
					'--tab-radius': '0.75rem'
				}
			},
			{
				ledgerdark: {
					primary: '#2dd4bf',
					'primary-content': '#042f2e',
					secondary: '#94a3b8',
					'secondary-content': '#0f172a',
					accent: '#818cf8',
					'accent-content': '#1e1b4b',
					neutral: '#0f172a',
					'neutral-content': '#e2e8f0',
					'base-100': '#0f172a',
					'base-200': '#1e293b',
					'base-300': '#334155',
					'base-content': '#f1f5f9',
					info: '#38bdf8',
					'info-content': '#0c4a6e',
					success: '#34d399',
					'success-content': '#064e3b',
					warning: '#fbbf24',
					'warning-content': '#78350f',
					error: '#f87171',
					'error-content': '#7f1d1d',
					'--rounded-box': '1rem',
					'--rounded-btn': '0.75rem',
					'--rounded-badge': '9999px',
					'--animation-btn': '0.2s',
					'--animation-input': '0.2s',
					'--btn-focus-scale': '0.98',
					'--border-btn': '1.5px',
					'--tab-border': '1.5px',
					'--tab-radius': '0.75rem'
				}
			}
		],
		darkTheme: 'ledgerdark',
		base: true,
		styled: true,
		utils: true,
		prefix: '',
		logs: false,
		themeRoot: ':root'
	}
};
