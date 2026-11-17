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

/** Fold only adjacent calls, preserving the turn's execution order. */
export function foldToolSteps(steps: readonly ToolStep[]): ToolRun[] {
  const groups: ToolStep[][] = [];
  for (const step of steps) {
    const last = groups.at(-1);
    if (last?.[0]?.tool === step.tool) last.push(step);
    else groups.push([step]);
  }
  return groups.flatMap((items) => {
    const step = items[0];
    if (!step) return [];
    const repeated = items.every((item) => item.target === step.target);
    let kind: ToolRun['kind'] = 'single';
    if (items.length > 1) kind = repeated ? 'repeat' : 'group';
    return [
      {
        step,
        steps: items,
        kind,
        target:
          kind === 'group'
            ? `${items.length} ${items.every((item) => item.path) ? 'files' : 'items'}`
            : step.basename,
        folder: kind === 'group' ? items.map((item) => item.basename).join(', ') : step.folder,
        title: items.map((item) => item.label).join('\n'),
      },
    ];
  });
}
