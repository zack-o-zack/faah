import { record, text, boolean, list, strings } from '../lib/decode.ts';
export interface Harness {
  name: string;
  installed: boolean;
  models: string[];
  cmd?: string;
  path?: string;
  model?: string;
}
export interface AgentSelection {
  harnesses: Harness[];
  selected: string;
  model: string;
  pinned: boolean;
}
export function decodeHarnesses(value: unknown): Harness[] {
  return list(value).map((item) => {
    const h = record(item);
    return {
      name: text(h.name),
      installed: boolean(h.installed),
      models: strings(h.models),
      cmd: text(h.cmd),
      path: text(h.path),
      model: text(h.model),
    };
  });
}
export function decodeAgents(value: unknown): AgentSelection {
  const v = record(value);
  return {
    harnesses: decodeHarnesses(v.harnesses),
    selected: text(v.selected),
    model: text(v.model),
    pinned: boolean(v.pinned),
  };
}
export function decodeModels(value: unknown): string[] {
  return strings(record(value).models);
}
