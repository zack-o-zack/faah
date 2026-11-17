export interface StepPaths {
  root?: string;
  home?: string;
}

export interface ToolStep {
  label: string;
  tool: string;
  icon: string;
  special: boolean;
  target: string;
  path: boolean;
  basename: string;
  folder: string;
}

export interface ToolRun {
  step: ToolStep;
  steps: ToolStep[];
  kind: 'single' | 'repeat' | 'group';
  target: string;
  folder: string;
  title: string;
}

const icons: Record<string, string> = {
  Read: 'icon-[ph--file-text]',
  Edit: 'icon-[ph--pencil-simple]',
  MultiEdit: 'icon-[ph--pencil-simple]',
  NotebookEdit: 'icon-[ph--pencil-simple]',
  Write: 'icon-[ph--file-plus]',
  Bash: 'icon-[ph--terminal]',
  Grep: 'icon-[ph--magnifying-glass]',
  Glob: 'icon-[ph--magnifying-glass]',
  WebFetch: 'icon-[ph--globe]',
  WebSearch: 'icon-[ph--globe]',
};

function within(path: string, directory?: string): string | undefined {
  if (!directory) return;
  const prefix = directory.replace(/\/+$/, '') + '/';
  if (path.startsWith(prefix)) return path.slice(prefix.length);
}

export function parseToolStep(label: string, paths: StepPaths = {}): ToolStep {
  const special = label === 'Show notes' || label === 'Show a walkthrough';
  const text = label.trim();
  const separator = text.search(/\s/);
  const tool = special ? label : text.slice(0, separator < 0 ? text.length : separator);
  const target = special || separator < 0 ? '' : text.slice(separator).trim();
  const path = target.includes('/') && !/\s/.test(target);
  let display = target;
  if (path) {
    const relative = within(target, paths.root);
    const home = within(target, paths.home);
    if (relative !== undefined) display = relative;
    else if (home !== undefined) display = '~/' + home;
  }
  const slash = display.replace(/\/+$/, '').lastIndexOf('/');
  const icon = Object.hasOwn(icons, tool) ? icons[tool] : undefined;
  return {
    label,
    tool,
    icon: special ? 'icon-[ph--spinner]' : icon || 'icon-[ph--wrench]',
    special,
    target,
    path,
    basename: path ? display.slice(slash + 1) : display,
    folder: path ? display.slice(0, slash + 1) : '',
  };
}

/** Short turns read best as plain rows; folding starts at this many steps. */
export const FOLD_MIN_STEPS = 9;

function run(items: ToolStep[], kind: ToolRun['kind']): ToolRun[] {
  const step = items[0];
  if (!step) return [];
  return [
    {
      step,
      steps: items,
      kind,
      target: kind === 'group' ? `${items.length} files` : step.basename,
      folder: kind === 'group' ? items.map((item) => item.basename).join(', ') : step.folder,
      title: items.map((item) => item.label).join('\n'),
    },
  ];
}

/** Adjacent calls with one target become a repeat; a single call stays a row. */
function repeats(items: ToolStep[]): ToolRun[] {
  const runs: ToolStep[][] = [];
  for (const item of items) {
    const last = runs.at(-1);
    if (last?.[0]?.target === item.target) last.push(item);
    else runs.push([item]);
  }
  return runs.flatMap((same) => run(same, same.length > 1 ? 'repeat' : 'single'));
}

/**
 * Fold only adjacent calls, preserving the turn's execution order. Only file
 * calls group into "N files"; commands and searches stay one per row, since
 * each one says something different.
 */
export function foldToolSteps(steps: readonly ToolStep[]): ToolRun[] {
  if (steps.length < FOLD_MIN_STEPS) return steps.flatMap((step) => run([step], 'single'));
  const tools: ToolStep[][] = [];
  for (const step of steps) {
    const last = tools.at(-1);
    if (last?.[0]?.tool === step.tool) last.push(step);
    else tools.push([step]);
  }
  return tools.flatMap((items) => {
    const files = items.every((item) => item.path);
    const mixed = items.some((item) => item.target !== items[0]?.target);
    return files && mixed ? run(items, 'group') : repeats(items);
  });
}
