import React, { useState } from 'react';
import { Stack, NumberInput, TagsInput } from '@mantine/core';
import { SectionCard } from '../../../../../frontend/src/lib/ui/cards.jsx';
import ConfigFormWrapper from "../../../../../frontend/src/modules/Admin/shared/ConfigFormWrapper.jsx";
import { configPath } from "../../../../../frontend/src/modules/Admin/utils/adminConfigPaths.js";

function updateNested(data, path, value) {
  const next = JSON.parse(JSON.stringify(data));
  const parts = path.split('.');
  let current = next;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) current[parts[i]] = {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
  return next;
}

const CLICKUP_ID_ERROR = 'Enter a whole-number ID within the safe integer range.';

function parseClickUpIds(tags, existingIds) {
  const originalIds = new Map();
  existingIds.forEach(id => {
    const key = String(id);
    const values = originalIds.get(key) || [];
    values.push(id);
    originalIds.set(key, values);
  });

  const ids = [];
  for (const tag of tags) {
    const originals = originalIds.get(tag);
    if (originals?.length) {
      ids.push(originals.shift());
      continue;
    }

    if (!/^(0|[1-9]\d*)$/.test(tag)) return null;
    const id = Number(tag);
    if (!Number.isSafeInteger(id) || String(id) !== tag) return null;
    ids.push(id);
  }
  return ids;
}

function ClickUpIdTagsInput({ label, ids, onChange, placeholder }) {
  const [error, setError] = useState(null);

  function handleChange(tags) {
    const nextIds = parseClickUpIds(tags, ids);
    if (nextIds === null) {
      setError(CLICKUP_ID_ERROR);
      return;
    }
    setError(null);
    onChange(nextIds);
  }

  return (
    <TagsInput
      label={label}
      value={ids.map(String)}
      onChange={handleChange}
      error={error}
      placeholder={placeholder}
    />
  );
}

function FinanceConfigContent({ data, setData }) {
  const buxfer = data.buxfer || {};
  const clickup = data.clickup || {};

  return (
    <Stack gap="lg">
      {/* Buxfer Integration */}
      <SectionCard variant="form" title="Buxfer Integration">
        <Stack gap="sm">
          <NumberInput
            label="Payroll Account ID"
            value={buxfer.payroll_account_id ?? ''}
            onChange={(val) => setData(updateNested(data, 'buxfer.payroll_account_id', val))}
          />
          <NumberInput
            label="Direct Deposit Account ID"
            value={buxfer.direct_deposit_account_id ?? ''}
            onChange={(val) => setData(updateNested(data, 'buxfer.direct_deposit_account_id', val))}
          />
          <NumberInput
            label="Tax Rate"
            value={buxfer.tax_rate ?? ''}
            onChange={(val) => setData(updateNested(data, 'buxfer.tax_rate', val))}
            step={0.01}
            decimalScale={2}
            min={0}
            max={1}
          />
        </Stack>
      </SectionCard>

      {/* ClickUp Integration */}
      <SectionCard variant="form" title="ClickUp Integration">
        <Stack gap="sm">
          <NumberInput
            label="Team ID"
            value={clickup.team_id ?? ''}
            onChange={(val) => setData(updateNested(data, 'clickup.team_id', val))}
          />
          <ClickUpIdTagsInput
            label="Assignees"
            ids={clickup.assignees || []}
            onChange={(ids) => setData(updateNested(data, 'clickup.assignees', ids))}
            placeholder="Add assignee ID..."
          />
          <TagsInput
            label="Statuses"
            value={clickup.statuses || []}
            onChange={(tags) => setData(updateNested(data, 'clickup.statuses', tags))}
            placeholder="Add status..."
          />
          <ClickUpIdTagsInput
            label="Todo Lists"
            ids={clickup.todo_lists || []}
            onChange={(ids) => setData(updateNested(data, 'clickup.todo_lists', ids))}
            placeholder="Add list ID..."
          />
          <TagsInput
            label="Todo Statuses"
            value={clickup.todo_statuses || []}
            onChange={(tags) => setData(updateNested(data, 'clickup.todo_statuses', tags))}
            placeholder="Add todo status..."
          />
          <NumberInput
            label="Todo Count"
            value={clickup.todo_count ?? ''}
            onChange={(val) => setData(updateNested(data, 'clickup.todo_count', val))}
            min={0}
          />
        </Stack>
      </SectionCard>
    </Stack>
  );
}

function FinanceConfig() {
  return (
    <ConfigFormWrapper
      filePath={configPath('finance')}
      title="Finance Configuration"
    >
      {({ data, setData }) => (
        <FinanceConfigContent data={data} setData={setData} />
      )}
    </ConfigFormWrapper>
  );
}

export default FinanceConfig;
