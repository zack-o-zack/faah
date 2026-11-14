import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import grammars from './grammars.json';
import { grammarLoader, type GrammarStore } from './loader.ts';
import { fenceLanguage } from './language.ts';
import { classFor } from './scopes.ts';
import { escape, plain } from './html.ts';
const embeddedNames: Record<string, string> = {
  'source.go': 'Go',
  'source.python': 'Python',
  'source.c': 'C',
  'source.css': 'CSS',
  'source.js': 'JavaScript',
  'source.ts': 'TypeScript',
  'source.tsx': 'TypeScript',
  'source.shell': 'Bash',
  'source.rust': 'Rust',
};
const grammarIDs: Record<string, string> = grammars;
export async function engine(store?: GrammarStore) {
  const started = performance.now();
  const highlighter = await createHighlighterCore({
    themes: [],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  const load = grammarLoader((...languages) => highlighter.loadLanguage(...languages), store);
  const initMs = performance.now() - started;
  const highlight = async (source: string, language: string, want: number): Promise<string[]> => {
    if (grammarIDs[language] !== undefined) source = source.replace(/\r\n?/g, '\n');
    const id = grammarIDs[language] ?? 'text';
    if (id === 'text') return plain(source, want);
    const start = performance.now();
    if (language === 'markdown') {
      for (const fence of source.matchAll(/^ {0,3}(?:`{3,}|~{3,})[ \t]*([^\s`~]+)/gm)) {
        const embedded = fenceLanguage(fence[1] ?? '');
        if (embedded && embedded !== 'markdown') await load(embedded);
      }
    }
    await load(language);
    const loadMs = performance.now() - start,
      tokenStart = performance.now();
    const lines = tokenLines(highlighter.getLanguage(id), source, language, want);
    if (process.env.FAAH_RENDER_PROFILE)
      process.stderr.write(
        JSON.stringify({
          type: 'render',
          language,
          initMs,
          loadMs,
          tokenMs: performance.now() - tokenStart,
          bytes: Buffer.byteLength(source),
          want,
        }) + '\n',
      );
    return lines;
  };
  return Object.assign(highlight, {
    warm: async (langs: readonly string[]) => {
      for (const lang of langs)
        await highlight(
          'package main\nimport "fmt"\nfunc main() { fmt.Println("warm", 42) }\nconst value = true;\ndef example(x: int): return x + 1\n# heading\n.a { color: red; }',
          lang,
          7,
        );
    },
  });
}

function tokenLines(
  grammar: ReturnType<Awaited<ReturnType<typeof createHighlighterCore>>['getLanguage']>,
  source: string,
  language: string,
  want: number,
): string[] {
  const lines: string[] = [];
  let state: ReturnType<typeof grammar.tokenizeLine>['ruleStack'] | null = null;
  try {
    for (const line of source.split('\n').slice(0, want)) {
      const result = grammar.tokenizeLine(line, state, 0);
      state = result.ruleStack;
      let html = '',
        text = '',
        cls = '';
      const flush = () => {
        if (text) html += cls ? '<i class=' + cls + '>' + escape(text) + '</i>' : escape(text);
      };
      for (const token of result.tokens) {
        const part = line.slice(token.startIndex, Math.min(line.length, token.endIndex));
        const embedded =
          language === 'markdown'
            ? token.scopes.findLast((scope) => scope.startsWith('source.'))
            : undefined;
        const tokenLanguage = embedded ? (embeddedNames[embedded] ?? language) : language;
        const next = classFor(token.scopes, tokenLanguage, part, line, token.startIndex);
        if (next === cls) text += part;
        else {
          flush();
          text = part;
          cls = next;
        }
      }
      flush();
      lines.push(html);
    }
  } catch (error) {
    process.stderr.write('faah render tokenize: ' + String(error) + '\n');
    return plain(source, want);
  }
  while (lines.length < want) lines.push('');
  return lines;
}
