import { PACKS } from '../../lib/theme/packs.mjs';

const DS_BLUE = [
  '#e8f0fe', '#c4d7fc', '#9ebcfa', '#789ff7', PACKS.admin.accent,
  '#3d6be0', '#3360cc', '#2952b3', '#1f4499', '#163680'
];

const themeExtras = {
  primaryColor: 'ds-blue',
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
          backgroundColor: 'var(--ds-surface-alt)',
          border: '1px solid var(--ds-border)',
        },
      },
    },
    TextInput: {
      defaultProps: { radius: 'sm' },
      styles: {
        input: {
          backgroundColor: 'var(--ds-background)',
          borderColor: 'var(--ds-border)',
        },
      },
    },
    NumberInput: {
      defaultProps: { radius: 'sm' },
      styles: {
        input: {
          backgroundColor: 'var(--ds-background)',
          borderColor: 'var(--ds-border)',
        },
      },
    },
    Select: {
      defaultProps: { radius: 'sm' },
      styles: {
        input: {
          backgroundColor: 'var(--ds-background)',
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
          backgroundColor: 'var(--ds-surface-alt)',
          border: '1px solid var(--ds-border)',
        },
        header: {
          backgroundColor: 'var(--ds-surface-alt)',
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
          color: 'var(--ds-text-mid)',
        },
      },
    },
  },
};

export const ADMIN_PACK = { ...PACKS.admin, colorRamps: { 'ds-blue': DS_BLUE }, themeExtras };
