import { expect, test } from 'vitest';
import {
  activeAfterChange,
  activeBlock,
  changeStage,
  configRequest,
  fileInsights,
  insightCounts,
  pipelineProgress,
  reviewStages,
  reviewTransition,
  stageDefinition,
  visibleFiles,
  workflowConfig,
} from './logic.js';

const def = (id) => ({ id, title: id.toUpperCase(), question: '', prompt: '' });
const run = (id, statuses) => ({
  id,
  status: 'running',
  activeStage: 0,
  stages: statuses.map((status, index) => ({ def: def('s' + index), status })),
});

test('whole runs replace the run only when they start or snapshot it', () => {
  const first = run('r1', ['pending', 'pending']);
  expect(reviewTransition(null, 'run_started', first)).toBe(first);
  const other = run('r2', ['completed', 'completed']);
  expect(reviewTransition(first, 'run_completed', other)).toBe(first);
  expect(reviewTransition(first, 'snapshot', other)).toBe(other);
  const stopped = { ...first, status: 'stopped' };
  expect(reviewTransition(first, 'run_stopped', stopped)).toBe(stopped);
});

test('stage events patch one stage by index or by definition id', () => {
  const current = run('r1', ['pending', 'pending']);
  const started = reviewTransition(current, 'stage_started', {
    runId: 'r1',
    stageIndex: 1,
    stage: { def: def('s1'), status: 'running' },
  });
  expect(started.activeStage).toBe(1);
  expect(started.stages[1].status).toBe('running');
  expect(started.stages[0]).toBe(current.stages[0]);
  const failed = reviewTransition(started, 'stage_failed', { def: def('s0'), status: 'failed' });
  expect(failed.stages[0].status).toBe('failed');
  expect(reviewTransition(started, 'stage_updated', { runId: 'other', stageIndex: 0 })).toBe(
    started,
  );
  expect(reviewTransition(null, 'stage_started', { stageIndex: 0, stage: {} })).toBe(null);
  expect(reviewTransition(started, 'stage_failed', { def: def('missing') })).toBe(started);
});

test('configured stages show their run state only while the run still matches them', () => {
  const config = { name: 'P', stages: [def('s0'), def('s9')] };
  const stages = reviewStages(config, run('r', ['completed', 'completed']));
  expect(stages[0].status).toBe('completed');
  expect(stages[0].def).toBe(config.stages[0]);
  expect(stages[1]).toEqual({ def: def('s9'), status: 'pending' });
});

test('progress summarises dots, counts and the stage being worked on', () => {
  const progress = pipelineProgress(run('r', ['completed', 'running', 'failed']).stages);
  expect(progress.done).toBe(1);
  expect(progress.summary).toBe('running');
  expect(progress.title).toBe('1 of 3 done · working on S1 · a stage failed');
});

test('config replies and requests carry the standard workflow', () => {
  const reply = {
    workflows: [{ id: 'standard', name: 'W', stages: [def('a')] }],
    activeId: 'standard',
  };
  expect(workflowConfig(reply)).toEqual({ name: 'W', stages: [def('a')] });
  expect(workflowConfig({})).toEqual({ name: 'Review pipeline', stages: [] });
  expect(configRequest({ name: 'W', stages: [] }).activeId).toBe('standard');
});

test('stage moves stay in bounds and the last stage cannot be removed', () => {
  const config = { name: 'P', stages: [def('a'), def('b')] };
  expect(changeStage(config, 0, 'up')).toBe(config);
  expect(changeStage(config, 0, 'down').stages.map((stage) => stage.id)).toEqual(['b', 'a']);
  expect(changeStage(config, 1, 'remove').stages).toHaveLength(1);
  expect(() => changeStage({ stages: [def('a')] }, 0, 'remove')).toThrow(/at least one/);
});

test('stage definitions need a title; new stages derive question and prompt', () => {
  expect(() => stageDefinition({ title: ' ', question: '', prompt: '' }, 'x')).toThrow();
  const added = stageDefinition({ title: 'Security', question: '', prompt: '' }, 'x', true);
  expect(added).toMatchObject({
    id: 'x',
    question: 'Security',
    prompt: 'Review the PR for Security.',
  });
  const edited = stageDefinition({ title: 'T', question: ' Q ', prompt: '' }, 'y', false);
  expect(edited).toMatchObject({ question: 'Q', prompt: '' });
});

test('insight filters narrow the file list and count each kind', () => {
  const files = [
    { path: 'a.go', understanding: { edgeCases: [{ line: 3 }], coreLogic: [{ line: 1 }] } },
    { path: 'b.go', understanding: {} },
  ];
  expect(insightCounts(files)).toEqual({ all: 2, fastReturns: 0, edgeCases: 1, coreLogic: 1 });
  expect(visibleFiles(files, 'all')).toHaveLength(2);
  expect(visibleFiles(files, 'edgeCases').map((file) => file.path)).toEqual(['a.go']);
  expect(fileInsights(files[0], 'all')).toEqual([]);
  expect(fileInsights(files[0], 'edgeCases')[0].line).toBe(3);
});

test('the selected stage follows a move and stays in range after removal', () => {
  expect(activeAfterChange(1, 1, 'up', 3)).toBe(0);
  expect(activeAfterChange(0, 1, 'up', 3)).toBe(1);
  expect(activeAfterChange(2, 0, 'down', 3)).toBe(2);
  expect(activeAfterChange(2, 2, 'remove', 2)).toBe(1);
});

test('the active diff block is the last one starting above the anchor', () => {
  expect(activeBlock([0, 100, 300], 150)).toBe(1);
  expect(activeBlock([200, 400], 70)).toBe(0);
});
