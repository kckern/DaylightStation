import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const mockConfig = {
  data: { key: 'value' },
  raw: 'key: value\n',
  loading: false,
  saving: false,
  error: null,
  dirty: false,
  load: vi.fn().mockResolvedValue({}),
  save: vi.fn().mockResolvedValue({}),
  revert: vi.fn(),
  setData: vi.fn(),
  setRaw: vi.fn(),
  clearError: vi.fn(),
};

vi.mock('../../../hooks/admin/useAdminConfig.js', () => ({
  useAdminConfig: () => mockConfig,
}));

import ConfigFormWrapper from './ConfigFormWrapper.jsx';

function r(ui) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

afterEach(() => {
  cleanup();
  mockConfig.dirty = false;
  mockConfig.save.mockClear();
  mockConfig.revert.mockClear();
});

describe('ConfigFormWrapper', () => {
  it('renders children with data/setData in parsed mode', () => {
    r(
      <ConfigFormWrapper filePath="x.yml" title="X">
        {({ data }) => <div>value: {data.key}</div>}
      </ConfigFormWrapper>
    );
    expect(screen.getByText(/value: value/)).toBeTruthy();
  });

  it('shows the Unsaved badge when dirty', () => {
    mockConfig.dirty = true;
    r(
      <ConfigFormWrapper filePath="x.yml" title="X">
        {() => <div>body</div>}
      </ConfigFormWrapper>
    );
    expect(screen.getByText('Unsaved')).toBeTruthy();
  });

  it('renders headerExtra content in the action bar', () => {
    r(
      <ConfigFormWrapper
        filePath="x.yml"
        title="X"
        headerExtra={<button type="button">Extra Action</button>}
      >
        {() => <div>body</div>}
      </ConfigFormWrapper>
    );
    expect(screen.getByText('Extra Action')).toBeTruthy();
  });

  it('rawMode passes raw/setRaw to children and saves with useRaw', () => {
    mockConfig.dirty = true;
    r(
      <ConfigFormWrapper filePath="x.yml" title="X" rawMode>
        {({ raw, setRaw }) => (
          <textarea value={raw} onChange={(e) => setRaw(e.target.value)} data-testid="raw-editor" />
        )}
      </ConfigFormWrapper>
    );
    expect(screen.getByTestId('raw-editor').value).toBe('key: value\n');

    fireEvent.click(screen.getByTestId('config-save-button'));
    expect(mockConfig.save).toHaveBeenCalledWith({ useRaw: true });
  });

  it('parsed mode saves without useRaw', () => {
    mockConfig.dirty = true;
    r(
      <ConfigFormWrapper filePath="x.yml" title="X">
        {() => <div>body</div>}
      </ConfigFormWrapper>
    );
    fireEvent.click(screen.getByTestId('config-save-button'));
    expect(mockConfig.save).toHaveBeenCalledWith({ useRaw: false });
  });
});
