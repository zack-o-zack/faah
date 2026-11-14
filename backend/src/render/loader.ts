import type { LanguageRegistration } from 'shiki';
import grammars from './grammars.json';
import { decodeGrammars } from './grammar.ts';
import { record, string } from '../decode.ts';
export interface GrammarStore {
  assets: Record<string, string>;
  groups: Record<string, string[]>;
}
const grammarIDs: Record<string, string> = grammars;
export function grammarLoader(
  register: (...languages: LanguageRegistration[]) => Promise<void>,
  store?: GrammarStore,
) {
  const loading = new Map<string, Promise<void>>();
  let sourceStore = store;
  async function assets(): Promise<GrammarStore> {
    if (sourceStore) return sourceStore;
    const value: unknown = await Bun.file(import.meta.dir + '/grammar-groups.json').json();
    const groups = Object.fromEntries(
      Object.entries(record(value)).map(([id, value]) => {
        if (!Array.isArray(value)) throw new Error('invalid grammar group');
        return [id, value.map((value) => string(value))];
      }),
    );
    const paths = Object.fromEntries(
      Object.values(groups)
        .flat()
        .map((name) => [
          name,
          import.meta.dir + '/grammar-data/' + encodeURIComponent(name) + '.json',
        ]),
    );
    sourceStore = { assets: paths, groups };
    return sourceStore;
  }
  return async (lang: string): Promise<void> => {
    const id = grammarIDs[lang];
    if (!id || id === 'text') return;
    let task = loading.get(id);
    if (!task) {
      task = (async () => {
        const data = await assets(),
          queue = [id],
          seen = new Set<string>(),
          all: LanguageRegistration[] = [];
        while (queue.length) {
          const next = queue.pop();
          if (!next || seen.has(next)) continue;
          seen.add(next);
          const group = data.groups[next];
          if (group) for (const name of group) if (name !== next) queue.push(name);
          const path = data.assets[next];
          if (!path) continue;
          const value: unknown = await Bun.file(path).json();
          for (const grammar of decodeGrammars(value)) {
            all.push(grammar);
            queue.push(...(grammar.embeddedLangs ?? []), ...(grammar.embeddedLanguages ?? []));
          }
        }
        await register(...all);
      })();
      loading.set(id, task);
    }
    await task;
  };
}
