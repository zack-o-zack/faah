import { test, expect } from 'bun:test';
import { groupAgentModels, filterAgentModels } from './agent-picker.js';

const harnesses = [
  { name: 'opencode', installed: true, models: ['OxionAI/model-a', 'OxionAI/model-b', 'other/model-c'] },
  { name: 'codex', installed: true, models: ['gpt-6.1-sol'] },
  { name: 'claude', installed: true, models: [] },
  { name: 'absent', installed: false, models: ['hidden'] },
];
test('provider grouping preserves exact model IDs and the default harness choice', () => {
  const groups = groupAgentModels(harnesses);
  expect(groups.map(g => g.provider)).toEqual(['OxionAI', 'other', 'codex', 'claude']);
  expect(groups[0].models).toEqual([{ value: 'OxionAI/model-a', label: 'model-a' }, { value: 'OxionAI/model-b', label: 'model-b' }]);
  expect(groups[3].models).toEqual([{ value: '', label: 'Default model' }]);
});
test('search matches provider, harness and model across groups without changing identifiers', () => {
  const groups = groupAgentModels(harnesses);
  expect(filterAgentModels(groups, ' OPENCODE model-b ')[0].models[0].value).toBe('OxionAI/model-b');
  expect(filterAgentModels(groups, 'oxionai')[0].models.length).toBe(2);
  expect(filterAgentModels(groups, 'no match')).toEqual([]);
  expect(filterAgentModels(groups, '').length).toBe(4);
  expect(groups[0].models.length).toBe(2);
});
