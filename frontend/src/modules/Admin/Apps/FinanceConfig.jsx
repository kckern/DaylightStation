import React from 'react';
import { Stack, NumberInput, Paper, Text, Divider } from '@mantine/core';
import ConfigFormWrapper from '../shared/ConfigFormWrapper.jsx';
import TagInput from '../shared/TagInput.jsx';

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

function FinanceConfigContent({ data, setData }) {
  const buxfer = data.buxfer || {};
  const clickup = data.clickup || {};

  return (
    <Stack gap="lg">
      {/* Buxfer Integration */}
      <Paper p="md" withBorder>
        <Text fw={600} mb="sm">Buxfer Integration</Text>
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
      </Paper>

      <Divider />

      {/* ClickUp Integration */}
      <Paper p="md" withBorder>
        <Text fw={600} mb="sm">ClickUp Integration</Text>
        <Stack gap="sm">
          <NumberInput
            label="Team ID"
            value={clickup.team_id ?? ''}
            onChange={(val) => setData(updateNested(data, 'clickup.team_id', val))}
          />
          <TagInput
            label="Assignees"
            values={(clickup.assignees || []).map(String)}
            onChange={(tags) =>
              setData(updateNested(data, 'clickup.assignees', tags.map(Number)))
            }
            placeholder="Add assignee ID and press Enter"
          />
          <TagInput
            label="Statuses"
            values={clickup.statuses || []}
            onChange={(tags) => setData(updateNested(data, 'clickup.statuses', tags))}
            placeholder="Add status and press Enter"
          />
          <TagInput
            label="Todo Lists"
            values={(clickup.todo_lists || []).map(String)}
            onChange={(tags) =>
              setData(updateNested(data, 'clickup.todo_lists', tags.map(Number)))
            }
            placeholder="Add list ID and press Enter"
          />
          <TagInput
            label="Todo Statuses"
            values={clickup.todo_statuses || []}
            onChange={(tags) => setData(updateNested(data, 'clickup.todo_statuses', tags))}
            placeholder="Add todo status and press Enter"
          />
          <NumberInput
            label="Todo Count"
            value={clickup.todo_count ?? ''}
            onChange={(val) => setData(updateNested(data, 'clickup.todo_count', val))}
            min={0}
          />
        </Stack>
      </Paper>
    </Stack>
  );
}

function FinanceConfig() {
  return (
    <ConfigFormWrapper
      filePath="household/config/finance.yml"
      title="Finance Configuration"
    >
      {({ data, setData }) => (
        <FinanceConfigContent data={data} setData={setData} />
      )}
    </ConfigFormWrapper>
  );
}

export default FinanceConfig;
