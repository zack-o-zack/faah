export const REVIEW_EVENTS = [
  'snapshot',
  'run_started',
  'stage_started',
  'stage_updated',
  'stage_completed',
  'stage_failed',
  'run_completed',
  'run_stopped',
];

export const STAGE_STATUS = {
  pending: { dot: 'bg-muted-foreground/40', label: 'Not started' },
  running: { dot: 'bg-warn animate-pulse', label: 'Working' },
  completed: { dot: 'bg-gi', label: 'Done' },
  failed: { dot: 'bg-destructive', label: 'Failed' },
  stopped: { dot: 'bg-muted-foreground/40 ring-1 ring-muted-foreground', label: 'Stopped' },
};

export const stageStatus = (stage) => (STAGE_STATUS[stage?.status] ? stage.status : 'pending');
export const isRunning = (run) => run?.status === 'running';

/** The server sends the active workflow either flat or inside its workflow list. */
export function workflowConfig(reply = {}) {
  const workflows = reply.workflows || [];
  const workflow = workflows.find((item) => item.id === reply.activeId) || workflows[0];
  const stages = reply.stages?.length ? reply.stages : workflow?.stages || [];
  return { name: reply.name || workflow?.name || 'Review pipeline', stages };
}

export function configRequest(config) {
  return {
    ...config,
    workflows: [{ id: 'standard', name: config.name, stages: config.stages }],
    activeId: 'standard',
  };
}

function stageIndex(run, data, stage) {
  if (Number.isInteger(data.stageIndex)) return data.stageIndex;
  return run.stages.findIndex((item) => item.def.id === stage.def.id);
}

/**
 * Fold one stream event into the run. Whole runs replace the run they describe;
 * stage events patch one stage of the current run and are ignored otherwise.
 */
export function reviewTransition(run, event, data) {
  if (!data) return run;
  if (Array.isArray(data.stages)) {
    const replaces = event === 'run_started' || event === 'snapshot';
    if (!replaces && run && data.id !== run.id) return run;
    return data;
  }
  if (!run) return run;
  if (data.runId && data.runId !== run.id) return run;
  const stage = data.stage || (data.def ? data : null);
  if (!stage) return run;
  const index = stageIndex(run, data, stage);
  if (index < 0 || index >= run.stages.length) return run;
  const stages = run.stages.slice();
  stages[index] = stage;
  return { ...run, activeStage: index, stages };
}

/** The configured stages, each with its run state when the run still matches it. */
export function reviewStages(config, run) {
  return config.stages.map((def, index) => {
    const stage = run?.stages?.[index];
    return stage?.def?.id === def.id ? { ...stage, def } : { def, status: 'pending' };
  });
}

export function pipelineProgress(stages) {
  const statuses = stages.map(stageStatus);
  const done = statuses.filter((status) => status === 'completed').length;
  const working = statuses.indexOf('running');
  const failed = statuses.includes('failed');
  let title = `${done} of ${stages.length} done`;
  if (working >= 0)
    title += ` · working on ${stages[working].def.title || 'stage ' + (working + 1)}`;
  if (failed) title += ' · a stage failed';
  let summary = done === stages.length ? 'completed' : 'pending';
  if (working >= 0) summary = 'running';
  else if (failed) summary = 'failed';
  return { statuses, done, total: stages.length, title, summary };
}

export function changeStage(config, index, action) {
  const stages = config.stages.slice();
  if (action === 'remove') {
    if (stages.length <= 1) throw new Error('A review pipeline needs at least one stage');
    stages.splice(index, 1);
    return { ...config, stages };
  }
  const to = index + (action === 'up' ? -1 : 1);
  if (to < 0 || to >= stages.length) return config;
  [stages[index], stages[to]] = [stages[to], stages[index]];
  return { ...config, stages };
}

/** The selected stage keeps its identity across a move or removal. */
export function activeAfterChange(active, index, action, count) {
  if (action === 'remove') return Math.min(active, count - 1);
  const to = action === 'up' ? index - 1 : index + 1;
  if (active === index) return to;
  if (active === to) return index;
  return active;
}

export const emptyStage = () => ({
  title: '',
  question: '',
  prompt: '',
  passPreviousContext: true,
});

/** A saved stage definition; a new stage gets a question and prompt from its title. */
export function stageDefinition(draft, id, isNew) {
  const title = draft.title.trim();
  if (!title) throw new Error('Give the stage a title');
  let question = draft.question.trim();
  let prompt = draft.prompt.trim();
  if (isNew) {
    if (!prompt && question)
      prompt = `Analyze the PR changes specifically for: ${question}. Highlight affected lines.`;
    if (!prompt) prompt = `Review the PR for ${title}.`;
    question ||= title;
  }
  return {
    ...draft,
    id,
    title,
    question,
    prompt,
    passPreviousContext: !!draft.passPreviousContext,
  };
}

export const INSIGHT_KINDS = [
  {
    id: 'fastReturns',
    label: 'Returns',
    icon: 'icon-[lucide--zap]',
    title: 'Fast returns & guardrails',
  },
  {
    id: 'edgeCases',
    label: 'Edge cases',
    icon: 'icon-[lucide--triangle-alert]',
    title: 'Error & edge case exits',
  },
  {
    id: 'coreLogic',
    label: 'Core',
    icon: 'icon-[lucide--target]',
    title: 'Core happy-path modifications',
  },
];

/** Insights shown under a file: none until a filter asks for one kind. */
export function fileInsights(file, filter) {
  const kind = INSIGHT_KINDS.find((item) => item.id === filter);
  if (!kind) return [];
  return (file.understanding?.[kind.id] || []).map((item) => ({ ...item, kind }));
}

export function visibleFiles(files, filter) {
  if (filter === 'all') return files;
  return files.filter((file) => fileInsights(file, filter).length);
}

export function insightCounts(files) {
  const counts = { all: files.length };
  for (const kind of INSIGHT_KINDS) {
    counts[kind.id] = files.reduce(
      (total, file) => total + (file.understanding?.[kind.id]?.length || 0),
      0,
    );
  }
  return counts;
}

/** A full commit hash says nothing a short one doesn't, at a fifth the width. */
export const shortRef = (ref) => (/^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 7) : ref);

export const rowLine = (row) => row.newLine || row.oldLine || 0;

/** The file whose block spans the anchor, given block tops in pane order. */
export function activeBlock(tops, anchor) {
  let active = 0;
  for (let index = 0; index < tops.length; index++) {
    if (tops[index] > anchor) break;
    active = index;
  }
  return active;
}
