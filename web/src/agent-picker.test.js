import { test, expect } from 'vitest';
import { groupAgentModels, filterAgentModels } from './agent-picker.js';

const harnesses = [
  { name: 'opencode', installed: true, models: ['OxionAI/model-a', 'OxionAI/model-b', 'other/model-c'] },
  { name: 'codex', installed: true, models: ['gpt-6.1-sol'] },
  { name: 'claude', installed: true, models: [] },
  { name: 'absent', installed: false, models: ['hidden'] },
];
test('agent grouping preserves exact model names, prefixes without inventing a default choice', () => {
  const groups = groupAgentModels(harnesses);
  expect(groups.map(g => g.harness)).toEqual(['opencode', 'codex', 'claude']);
  expect(groups[0].models).toEqual([{ value: 'OxionAI/model-a', label: 'OxionAI/model-a' }, { value: 'OxionAI/model-b', label: 'OxionAI/model-b' }, { value: 'other/model-c', label: 'other/model-c' }]);
  expect(groups[2].models).toEqual([]);
});
test('search matches provider, harness and model across groups without changing identifiers', () => {
  const groups = groupAgentModels(harnesses);
  expect(filterAgentModels(groups, ' OPENCODE model-b ')[0].models[0].value).toBe('OxionAI/model-b');
  expect(filterAgentModels(groups, 'oxionai')[0].models.length).toBe(2);
  expect(filterAgentModels(groups, 'no match')).toEqual([]);
  expect(filterAgentModels(groups, '').length).toBe(2);
  expect(groups[0].models.length).toBe(3);
});
