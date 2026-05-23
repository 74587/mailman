/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
        './src/components/**/*.{js,ts,jsx,tsx,mdx}',
        './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    ],
    darkMode: 'class',
    theme: {
    	extend: {
    		colors: {
    			primary: {
    				'50': '#eff6ff',
    				'100': '#dbeafe',
    				'200': '#bfdbfe',
    				'300': '#93bbfd',
    				'400': '#60a5fa',
    				'500': '#3b82f6',
    				'600': '#2563eb',
    				'700': '#1d4ed8',
    				'800': '#1e40af',
    				'900': '#1e3a8a',
    				'950': '#172554',
    				DEFAULT: 'hsl(var(--primary))',
    				foreground: 'hsl(var(--primary-foreground))'
    			},
    			gray: {
    				'50': '#f9fafb',
    				'100': '#f3f4f6',
    				'200': '#e5e7eb',
    				'300': '#d1d5db',
    				'400': '#9ca3af',
    				'500': '#6b7280',
    				'600': '#4b5563',
    				'700': '#374151',
    				'800': '#1f2937',
    				'900': '#111827',
    				'950': '#030712'
    			},
    			background: 'hsl(var(--background))',
    			foreground: 'hsl(var(--foreground))',
    			card: {
    				DEFAULT: 'hsl(var(--card))',
    				foreground: 'hsl(var(--card-foreground))'
    			},
    			popover: {
    				DEFAULT: 'hsl(var(--popover))',
    				foreground: 'hsl(var(--popover-foreground))'
    			},
    			secondary: {
    				DEFAULT: 'hsl(var(--secondary))',
    				foreground: 'hsl(var(--secondary-foreground))'
    			},
    			muted: {
    				DEFAULT: 'hsl(var(--muted))',
    				foreground: 'hsl(var(--muted-foreground))'
    			},
    			accent: {
    				DEFAULT: 'hsl(var(--accent))',
    				foreground: 'hsl(var(--accent-foreground))'
    			},
    			destructive: {
    				DEFAULT: 'hsl(var(--destructive))',
    				foreground: 'hsl(var(--destructive-foreground))'
    			},
    			border: 'hsl(var(--border))',
    			input: 'hsl(var(--input))',
    			ring: 'hsl(var(--ring))',
    			chart: {
    				'1': 'hsl(var(--chart-1))',
    				'2': 'hsl(var(--chart-2))',
    				'3': 'hsl(var(--chart-3))',
    				'4': 'hsl(var(--chart-4))',
    				'5': 'hsl(var(--chart-5))'
			},
			// Semantic component colors - auto-switch with theme
			sidebar: {
				bg: 'rgb(var(--sidebar-bg))',
				text: 'rgb(var(--sidebar-text))',
				'text-hover': 'rgb(var(--sidebar-text-hover))',
				active: 'rgb(var(--sidebar-active))',
				'active-bg': 'rgb(var(--sidebar-active-bg))',
				'hover-bg': 'rgb(var(--sidebar-hover-bg))',
				border: 'rgb(var(--sidebar-border))',
			},
			'btn-icon': {
				bg: 'rgb(var(--btn-icon-bg))',
				text: 'rgb(var(--btn-icon-text))',
				'hover-bg': 'rgb(var(--btn-icon-hover-bg))',
			},
			'input-custom': {
				bg: 'rgb(var(--input-bg))',
				border: 'rgb(var(--input-border))',
				focus: 'rgb(var(--input-focus))',
				placeholder: 'rgb(var(--input-placeholder))',
			},
			'card-custom': {
				bg: 'rgb(var(--card-bg))',
				border: 'rgb(var(--card-border))',
			}
    		},
    		fontFamily: {
    			sans: [
    				'Inter',
    				'system-ui',
    				'sans-serif'
    			]
    		},
    		animation: {
    			'fade-in': 'fadeIn 0.5s ease-in-out',
    			'fade-out': 'fadeOut 0.5s ease-in-out',
    			'slide-in-right': 'slideInRight 0.3s ease-out',
    			'slide-in-left': 'slideInLeft 0.3s ease-out',
    			'slide-in-up': 'slideInUp 0.3s ease-out',
    			'slide-in-down': 'slideInDown 0.3s ease-out',
    			'bounce-in': 'bounceIn 0.5s ease-out',
    			'spin-slow': 'spin 3s linear infinite',
    			'pulse-slow': 'pulse 3s ease-in-out infinite',
    			shimmer: 'shimmer 2s linear infinite'
    		},
    		keyframes: {
    			fadeIn: {
    				'0%': {
    					opacity: '0'
    				},
    				'100%': {
    					opacity: '1'
    				}
    			},
    			fadeOut: {
    				'0%': {
    					opacity: '1'
    				},
    				'100%': {
    					opacity: '0'
    				}
    			},
    			slideInRight: {
    				'0%': {
    					transform: 'translateX(100%)',
    					opacity: '0'
    				},
    				'100%': {
    					transform: 'translateX(0)',
    					opacity: '1'
    				}
    			},
    			slideInLeft: {
    				'0%': {
    					transform: 'translateX(-100%)',
    					opacity: '0'
    				},
    				'100%': {
    					transform: 'translateX(0)',
    					opacity: '1'
    				}
    			},
    			slideInUp: {
    				'0%': {
    					transform: 'translateY(100%)',
    					opacity: '0'
    				},
    				'100%': {
    					transform: 'translateY(0)',
    					opacity: '1'
    				}
    			},
    			slideInDown: {
    				'0%': {
    					transform: 'translateY(-100%)',
    					opacity: '0'
    				},
    				'100%': {
    					transform: 'translateY(0)',
    					opacity: '1'
    				}
    			},
    			bounceIn: {
    				'0%': {
    					transform: 'scale(0.3)',
    					opacity: '0'
    				},
    				'50%': {
    					transform: 'scale(1.05)'
    				},
    				'70%': {
    					transform: 'scale(0.9)'
    				},
    				'100%': {
    					transform: 'scale(1)',
    					opacity: '1'
    				}
    			},
    			shimmer: {
    				'0%': {
    					backgroundPosition: '-200% 0'
    				},
    				'100%': {
    					backgroundPosition: '200% 0'
    				}
    			}
    		},
    		backgroundImage: {
    			'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
    			'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
    			shimmer: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%)'
    		},
    		backdropBlur: {
    			xs: '2px'
    		},
    		borderRadius: {
    			lg: 'var(--radius)',
    			md: 'calc(var(--radius) - 2px)',
    			sm: 'calc(var(--radius) - 4px)'
    		}
    	}
    },
    plugins: [
        require('@tailwindcss/forms'),
        require('@tailwindcss/typography'),
        require("tailwindcss-animate")
    ],
}