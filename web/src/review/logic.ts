import type {
  StageDraft,
  StageDef,
  StageState,
  ReviewRun,
  ReviewConfig,
  WorkflowReply,
  ReviewEvent,
  WalkthroughFile,
  FileGroup,
} from './types.ts';
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

function knownStatus(value: string): value is keyof typeof STAGE_STATUS {
  return Object.hasOwn(STAGE_STATUS, value);
}
export function stageStatus(
  stage: { status?: string } | null | undefined,
): keyof typeof STAGE_STATUS {
  const status = stage?.status;
  return status && knownStatus(status) ? status : 'pending';
}
export const isRunning = (run: ReviewRun | null | undefined): boolean => run?.status === 'running';

/** The server sends the active workflow either flat or inside its workflow list. */
export function workflowConfig(reply: WorkflowReply = {}): ReviewConfig {
  const workflows = reply.workflows || [];
  const workflow = workflows.find((item) => item.id === reply.activeId) || workflows[0];
  const stages = reply.stages?.length ? reply.stages : workflow?.stages || [];
  return { name: reply.name || workflow?.name || 'Review pipeline', stages };
}

export function configRequest(config: ReviewConfig): ReviewConfig & {
  workflows: { id: string; name: string; stages: StageDef[] }[];
  activeId: string;
} {
  return {
    ...config,
    workflows: [{ id: 'standard', name: config.name, stages: config.stages }],
    activeId: 'standard',
  };
}

function stageIndex(run: ReviewRun, data: ReviewEvent, stage: StageState): number {
  if (
    'stageIndex' in data &&
    typeof data.stageIndex === 'number' &&
    Number.isInteger(data.stageIndex)
  )
    return data.stageIndex;
  return run.stages.findIndex((item) => item.def.id === stage.def.id);
}

/**
 * Fold one stream event into the run. Whole runs replace the run they describe;
 * stage events patch one stage of the current run and are ignored otherwise.
 */
export function reviewTransition(
  run: ReviewRun | null,
  event: string,
  data: ReviewEvent | null,
): ReviewRun | null {
  if (!data) return run;
  if ('stages' in data) {
    const replaces = event === 'run_started' || event === 'snapshot';
    if (!replaces && run && data.id !== run.id) return run;
    return data;
  }
  if (!run) return run;
  if ('runId' in data && data.runId && data.runId !== run.id) return run;
  const stage = 'def' in data ? data : data.stage;
  if (!stage) return run;
  const index = stageIndex(run, data, stage);
  if (index < 0 || index >= run.stages.length) return run;
  const stages = run.stages.slice();
  stages[index] = stage;
  return { ...run, activeStage: index, stages };
}

/** The configured stages, each with its run state when the run still matches it. */
export function reviewStages(config: ReviewConfig, run: ReviewRun | null): StageState[] {
  return config.stages.map((def, index) => {
    const stage = run?.stages?.[index];
    return stage?.def?.id === def.id ? { ...stage, def } : { def, status: 'pending' };
  });
}

export function pipelineProgress(stages: StageState[]): {
  statuses: string[];
  done: number;
  total: number;
  title: string;
  summary: string;
} {
  const statuses = stages.map(stageStatus);
  const done = statuses.filter((status) => status === 'completed').length;
  const working = statuses.indexOf('running');
  const failed = statuses.includes('failed');
  let title = `${done} of ${stages.length} done`;
  if (working >= 0)
    title += ` · working on ${stages[working]?.def.title || 'stage ' + (working + 1)}`;
  if (failed) title += ' · a stage failed';
  let summary = done === stages.length ? 'completed' : 'pending';
  if (working >= 0) summary = 'running';
  else if (failed) summary = 'failed';
  return { statuses, done, total: stages.length, title, summary };
}

export function changeStage(config: ReviewConfig, index: number, action: string): ReviewConfig {
  const stages = config.stages.slice();
  if (action === 'remove') {
    if (stages.length <= 1) throw new Error('A review pipeline needs at least one stage');
    stages.splice(index, 1);
    return { ...config, stages };
  }
  const to = index + (action === 'up' ? -1 : 1);
  if (to < 0 || to >= stages.length) return config;
  const from = stages[index];
  const target = stages[to];
  if (!from || !target) return config;
  [stages[index], stages[to]] = [target, from];
  return { ...config, stages };
}

/** The selected stage keeps its identity across a move or removal. */
export function activeAfterChange(
  active: number,
  index: number,
  action: string,
  count: number,
): number {
  if (action === 'remove') return Math.min(active, count - 1);
  const to = action === 'up' ? index - 1 : index + 1;
  if (active === index) return to;
  if (active === to) return index;
  return active;
}

export const emptyStage = (): StageDraft => ({
  title: '',
  question: '',
  prompt: '',
  passPreviousContext: true,
});

/** A saved stage definition; a new stage gets a question and prompt from its title. */
export function stageDefinition(draft: StageDraft, id: string, isNew: boolean): StageDef {
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

export const FILE_GROUPS: { id: FileGroup; label: string; icon: string; title: string }[] = [
  { id: 'core', label: 'Core', icon: 'icon-[lucide--code]', title: 'Production source files' },
  {
    id: 'tests',
    label: 'Tests',
    icon: 'icon-[lucide--flask-conical]',
    title: 'Test files and fixtures',
  },
  { id: 'config', label: 'Config', icon: 'icon-[lucide--settings]', title: 'Configuration files' },
  { id: 'docs', label: 'Docs', icon: 'icon-[lucide--book-open]', title: 'Documentation files' },
  {
    id: 'generated',
    label: 'Generated',
    icon: 'icon-[lucide--file-cog]',
    title: 'Generated files and lockfiles',
  },
];

export function groupCounts(files: WalkthroughFile[]): Record<string, number> {
  const counts: Record<string, number> = { all: files.length };
  for (const group of FILE_GROUPS)
    counts[group.id] = files.filter((file) => file.group === group.id).length;
  return counts;
}
export function activeGroupFilter(files: WalkthroughFile[], filter: string): string {
  return files.some((file) => file.group === filter) ? filter : 'all';
}
export function visibleFiles(files: WalkthroughFile[], filter: string): WalkthroughFile[] {
  const active = activeGroupFilter(files, filter);
  return active === 'all' ? files : files.filter((file) => file.group === active);
}
export function groupedFiles(files: WalkthroughFile[], filter: string) {
  const visible = visibleFiles(files, filter);
  return FILE_GROUPS.map((group) => {
    const members = visible.filter((file) => file.group === group.id);
    return {
      ...group,
      files: members,
      additions: members.reduce((sum, file) => sum + (file.additions || 0), 0),
      deletions: members.reduce((sum, file) => sum + (file.deletions || 0), 0),
    };
  }).filter((group) => group.files.length);
}
export const movedOnly = (file: WalkthroughFile): boolean => !!file.oldPath && !file.hunks?.length;

/** A full commit hash says nothing a short one doesn't, at a fifth the width. */
export const shortRef = (ref: string): string =>
  /^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 7) : ref;

export const rowLine = (row: { newLine?: number; oldLine?: number }): number =>
  row.newLine || row.oldLine || 0;

/** The file whose block spans the anchor, given block tops in pane order. */
export function activeBlock(tops: number[], anchor: number): number {
  let active = 0;
  for (let index = 0; index < tops.length; index++) {
    if ((tops[index] ?? 0) > anchor) break;
    active = index;
  }
  return active;
}
