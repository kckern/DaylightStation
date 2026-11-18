import { PACKS } from '../../lib/theme/packs.mjs';

const DS_BLUE = [
  '#e8f0fe', '#c4d7fc', '#9ebcfa', '#789ff7', PACKS.admin.accent,
  '#3d6be0', '#3360cc', '#2952b3', '#1f4499', '#163680'
];

const themeExtras = {
  primaryColor: 'ds-blue',
  fontFamily: '"IBM Plex Sans", -apple-system, sans-serif',
  fontFamilyMonospace: '"JetBrains Mono", "Fira Code", monospace',
  headings: {
    fontFamily: '"JetBrains Mono", monospace',
    fontWeight: '600',
    sizes: {
      h1: { fontSize: '24px', lineHeight: '1.3' },
      h2: { fontSize: '20px', lineHeight: '1.35' },
      h3: { fontSize: '16px', lineHeight: '1.4' },
    },
  },
  defaultRadius: 'sm',
  components: {
    Portal: { defaultProps: { target: '#admin-portals' } },
    Button: {
      defaultProps: { radius: 'sm' },
    },
    Paper: {
      defaultProps: { radius: 'md' },
      styles: {
        root: {
          backgroundColor: 'var(--ds-bg-elevated)',
          border: '1px solid var(--ds-border)',
        },
      },
    },
    TextInput: {
      defaultProps: { radius: 'sm' },
      styles: {
        input: {
          backgroundColor: 'var(--ds-bg-base)',
          borderColor: 'var(--ds-border)',
        },
      },
    },
    NumberInput: {
      defaultProps: { radius: 'sm' },
      styles: {
        input: {
          backgroundColor: 'var(--ds-bg-base)',
          borderColor: 'var(--ds-border)',
        },
      },
    },
    Select: {
      defaultProps: { radius: 'sm' },
      styles: {
        input: {
          backgroundColor: 'var(--ds-bg-base)',
          borderColor: 'var(--ds-border)',
        },
      },
    },
    Badge: {
      defaultProps: { radius: 'sm', variant: 'light' },
    },
    Modal: {
      styles: {
        content: {
          backgroundColor: 'var(--ds-bg-elevated)',
          border: '1px solid var(--ds-border)',
        },
        header: {
          backgroundColor: 'var(--ds-bg-elevated)',
        },
      },
    },
    Table: {
      styles: {
        th: {
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: '11px',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--ds-text-secondary)',
        },
      },
    },
  },
};

export const ADMIN_PACK = { ...PACKS.admin, colorRamps: { 'ds-blue': DS_BLUE }, themeExtras };
