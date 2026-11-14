import { readFileSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { parse, object } from '../decode.ts';
import { parseSettings } from './json.ts';
import { schema } from './schema.ts';
export function settingsPath(): string {
  return join(
    process.env.XDG_CONFIG_HOME
      ? join(process.env.XDG_CONFIG_HOME, 'faah')
      : join(homedir(), '.faah'),
    'settings.json',
  );
}
export function atomicWrite(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = path + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp';
  try {
    writeFileSync(temp, text, { mode: 0o644, flag: 'wx' });
    renameSync(temp, path);
  } finally {
    try {
      unlinkSync(temp);
    } catch {
      /* Rename already removed the temporary path after a successful save. */
    }
  }
}
export function defaults(): Record<string, unknown> {
  return {
    ...Object.fromEntries(schema.map((s) => [s.key, s.default])),
    agent: '',
    models: {},
    'explorer.autoRelveal': true,
  };
}
function validate(values: Record<string, unknown>): void {
  for (const key of ['agent', 'agent.harness', 'explain.agent']) {
    const v = values[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string') throw new Error(key + ' must be an agent name');
    if (v && !['claude', 'codex', 'agy', 'opencode', 'cursor-agent'].includes(v))
      throw new Error(
        `unknown agent ${v}; choose one of: claude, codex, agy, opencode, cursor-agent`,
      );
  }
}
export class Settings {
  constructor(readonly path = settingsPath()) {}
  raw(): Record<string, unknown> {
    try {
      return parse(readFileSync(this.path, 'utf8'));
    } catch {
      return {};
    }
  }
  rawJSON(): string {
    try {
      const text = readFileSync(this.path, 'utf8');
      if (!text) return '{\n}\n';
      try {
        return format(parse(text));
      } catch {
        return text;
      }
    } catch {
      return '{\n}\n';
    }
  }
  merged(): Record<string, unknown> {
    const raw = this.raw();
    const result = { ...defaults(), ...raw };
    for (const [a, b] of [
      ['agent', 'agent.harness'],
      ['models', 'agent.models'],
      ['server.basePath', 'basePath'],
    ]) {
      if (!a || !b) continue;
      const left = raw[a],
        right = raw[b];
      const valid = (value: unknown) =>
        a === 'models'
          ? object(value) && Object.keys(value).length > 0
          : typeof value === 'string' && value !== '';
      if (valid(left)) result[b === 'basePath' ? a : b] = left;
      else if (valid(right)) result[a] = right;
    }
    const auto =
      [
        raw['explorer.autoReveal'],
        raw['explorer.autoRelveal'],
        raw.autoReveal,
        raw.autoRelveal,
      ].find((v) => typeof v === 'boolean') ?? true;
    result['explorer.autoReveal'] = auto;
    result['explorer.autoRelveal'] = auto;
    return result;
  }
  update(values: Record<string, unknown>): void {
    validate(values);
    const raw = this.raw();
    for (const [key, value] of Object.entries(values)) {
      if (value === null) delete raw[key];
      else raw[key] = value;
      for (const [a, b] of [
        ['agent', 'agent.harness'],
        ['models', 'agent.models'],
      ]) {
        if (!a || !b) continue;
        const other = key === a ? b : key === b ? a : '';
        if (other) {
          if (value === null || (a === 'agent' && value === '')) delete raw[other];
          else raw[other] = value;
        }
      }
      if (key === 'basePath' || key === 'server.basePath') {
        if (value === null || value === '') {
          delete raw.basePath;
          delete raw['server.basePath'];
        } else raw['server.basePath'] = value;
      }
      if (
        ['explorer.autoReveal', 'explorer.autoRelveal', 'autoReveal', 'autoRelveal'].includes(key)
      ) {
        if (value === null) {
          for (const k of [
            'explorer.autoReveal',
            'explorer.autoRelveal',
            'autoReveal',
            'autoRelveal',
          ])
            delete raw[k];
        } else {
          raw['explorer.autoReveal'] = value;
          raw['explorer.autoRelveal'] = value;
        }
      }
    }
    atomicWrite(this.path, format(raw));
  }
  saveRaw(text: string): void {
    const raw = parseSettings(text);
    validate(raw);
    if (typeof raw.agent === 'string' && raw.agent) raw['agent.harness'] = raw.agent;
    else if (typeof raw['agent.harness'] === 'string' && raw['agent.harness'])
      raw.agent = raw['agent.harness'];
    atomicWrite(this.path, format(raw));
  }
}
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (object(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sorted(value[k])]),
    );
  return value;
}
function format(value: unknown): string {
  return JSON.stringify(sorted(value), null, 2) + '\n';
}
