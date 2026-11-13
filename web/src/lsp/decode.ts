import { record, text, number, boolean, list, strings } from '../lib/decode.ts';
import { decodeLsp } from '../editor/decode.ts';
import type { LspBrief } from '../editor/decode.ts';
import { decodeNavHit } from '../search/decode.ts';
import type { NavHit } from '../search/decode.ts';
export interface InstallOption {
  index: number;
  cmd: string;
  auto: boolean;
  tool: string;
  hasTool: boolean;
}
export interface InstallJob {
  server: string;
  cmd: string;
  running: boolean;
  error: string;
  log: string;
}
export interface ServerInfo {
  name: string;
  lang: string;
  fullLang: string;
  memBytes?: number;
  exts: string[];
  installed: boolean;
  running: boolean;
  state: string;
  options: InstallOption[];
  autoOpt: number;
  error: string;
  job?: InstallJob;
}
export interface ServersReply {
  enabled: boolean;
  anyRunning: boolean;
  servers: ServerInfo[];
}
export interface SetupReply extends LspBrief {
  enabled: boolean;
  lang: string;
  reason: string;
  servers: { name: string; options: InstallOption[]; job?: InstallJob }[];
}
export interface CallNode {
  name: string;
  detail?: string;
  kind?: string;
  path: string;
  line: number;
  ext?: boolean;
  sitePath?: string;
  sites?: number[];
  item?: string;
}
export function decodeJob(value: unknown): InstallJob {
  const v = record(value);
  return {
    server: text(v.server),
    cmd: text(v.cmd),
    running: boolean(v.running),
    error: text(v.error),
    log: text(v.log),
  };
}
function decodeOptions(value: unknown): InstallOption[] {
  return list(value).map((item) => {
    const v = record(item);
    return {
      index: number(v.index),
      cmd: text(v.cmd),
      auto: boolean(v.auto),
      tool: text(v.tool),
      hasTool: boolean(v.hasTool),
    };
  });
}
export function decodeServers(value: unknown): ServersReply {
  const v = record(value);
  return {
    enabled: boolean(v.enabled),
    anyRunning: boolean(v.anyRunning),
    servers: list(v.servers).map((item) => {
      const s = record(item);
      return {
        name: text(s.name),
        lang: text(s.lang),
        fullLang: text(s.fullLang),
        memBytes: number(s.memBytes),
        exts: strings(s.exts),
        installed: boolean(s.installed),
        running: boolean(s.running),
        state: text(s.state),
        options: decodeOptions(s.options),
        autoOpt: number(s.autoOpt, -1),
        error: text(s.error),
        job: s.job ? decodeJob(s.job) : undefined,
      };
    }),
  };
}
export function decodeSetup(value: unknown): SetupReply {
  const v = record(value);
  return {
    ...decodeLsp(v),
    enabled: boolean(v.enabled),
    lang: text(v.lang),
    reason: text(v.reason),
    servers: list(v.servers).map((item) => {
      const s = record(item);
      return {
        name: text(s.name),
        options: decodeOptions(s.options),
        job: s.job ? decodeJob(s.job) : undefined,
      };
    }),
  };
}
export function decodeNavigation(value: unknown): LspBrief & { hits: NavHit[] } {
  const v = record(value);
  return { ...decodeLsp(v), hits: list(v.hits).map(decodeNavHit) };
}
export function decodeDefinition(value: unknown): { defs: NavHit[]; lsp: LspBrief } {
  const v = record(value);
  return { defs: list(v.defs).map(decodeNavHit), lsp: decodeLsp(v.lsp) };
}
export function decodeCalls(value: unknown): LspBrief & { nodes: CallNode[]; error: string } {
  const v = record(value);
  return {
    ...decodeLsp(v),
    error: text(v.error),
    nodes: list(v.nodes).map((item) => {
      const n = record(item);
      return {
        name: text(n.name),
        detail: text(n.detail),
        kind: text(n.kind),
        path: text(n.path),
        line: number(n.line),
        ext: boolean(n.ext),
        sitePath: text(n.sitePath),
        sites: list(n.sites).map((item) => number(item)),
        item: text(n.item),
      };
    }),
  };
}
