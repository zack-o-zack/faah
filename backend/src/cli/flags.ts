const booleans = [
  'no-open',
  'no-lsp',
  'no-git',
  'no-agent',
  'version',
  'v',
  'update',
  'no-update',
  'no-color',
  'quiet',
  'verbose',
  'no-telemetry',
  'y',
  'yes',
  'workbench-child',
  'desktop-host',
];
export interface Flags {
  bool: Set<string>;
  host: string;
  port: number;
  basePath: string;
  agent: string;
  targets: string[];
}
export function flags(args: string[]): Flags {
  const result: Flags = {
    bool: new Set(),
    host: '127.0.0.1',
    port: 7777,
    basePath: '',
    agent: '',
    targets: [],
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) break;
    if (arg === '--') {
      result.targets = args.slice(i + 1);
      break;
    }
    if (!arg.startsWith('-') || arg === '-') {
      result.targets = args.slice(i);
      break;
    }
    const parts = arg.replace(/^--?/, '').split('=');
    const name = parts.shift() ?? '';
    let value = parts.length ? parts.join('=') : undefined;
    if (booleans.includes(name)) {
      if (value === undefined || ['true', '1', 't', 'TRUE', 'True'].includes(value))
        result.bool.add(name);
      else if (!['false', '0', 'f', 'FALSE', 'False'].includes(value))
        throw new Error(`invalid value "${value}" for flag -${name}: parse error`);
      else result.bool.delete(name);
      continue;
    }
    if (!['host', 'port', 'agent', 'base-path'].includes(name))
      throw new Error(`flag provided but not defined: -${name}`);
    value ??= args[++i];
    if (value === undefined) throw new Error(`flag needs an argument: -${name}`);
    switch (name) {
      case 'host':
        result.host = value;
        break;
      case 'port':
        if (!/^[+-]?\d+$/.test(value))
          throw new Error(`invalid value "${value}" for flag -port: parse error`);
        result.port = Number(value);
        break;
      case 'agent':
        result.agent = value;
        break;
      case 'base-path':
        result.basePath = value;
    }
  }
  if (result.bool.has('desktop-host')) {
    if (result.targets.length || result.bool.has('workbench-child'))
      throw new Error('-desktop-host requires a workbench without a target');
    result.host = '127.0.0.1';
    result.port = 0;
    result.basePath = '/';
    result.bool.add('no-open');
    result.bool.add('no-update');
  }
  return result;
}
export function featureArgs(f: Flags): string[] {
  const args = ['no-lsp', 'no-git', 'no-agent', 'no-telemetry']
    .filter((k) => f.bool.has(k))
    .map((k) => `-${k}`);
  if (f.agent) args.push('-agent', f.agent);
  return args;
}
