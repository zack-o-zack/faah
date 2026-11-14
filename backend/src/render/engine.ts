import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { bundledLanguagesInfo } from 'shiki/langs';
import theme from 'shiki/themes/github-dark.mjs';
import grammars from './grammars.json';
import { classFor } from './scopes.ts';
import { escape, plain } from './html.ts';
const grammarIDs: Record<string, string> = grammars;
export async function engine() {
  const highlighter = await createHighlighterCore({
    themes: [theme],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  const loading = new Map<string, Promise<void>>();
  return async (source: string, language: string, want: number): Promise<string[]> => {
    const id = grammarIDs[language] ?? 'text';
    if (id === 'text') return plain(source, want);
    const grammar = bundledLanguagesInfo.find((g) => g.id === id);
    if (!grammar) return plain(source, want);
    let ready = loading.get(id);
    if (!ready) {
      ready = highlighter.loadLanguage(grammar.import());
      loading.set(id, ready);
    }
    try {
      await ready;
      const tokens = highlighter.codeToTokensBase(source, {
        lang: id,
        theme: 'github-dark',
        includeExplanation: 'scopeName',
        tokenizeMaxLineLength: 0,
        tokenizeTimeLimit: 0,
      });
      const sourceLines = source.split('\n');
      const lines = tokens.map((line, lineIndex) => {
        let offset = 0;
        const runs: { cls: string; text: string }[] = [];
        for (const token of line) {
          const explanations = token.explanation ?? [{ content: token.content, scopes: [] }];
          for (const part of explanations) {
            const cls = classFor(
              part.scopes.map((s) => s.scopeName),
              language,
              part.content,
              sourceLines[lineIndex] ?? '',
              offset,
            );
            offset += part.content.length;
            const previous = runs.at(-1);
            if (previous?.cls === cls) previous.text += part.content;
            else runs.push({ cls, text: part.content });
          }
        }
        return runs
          .map(({ cls, text }) =>
            cls && text ? `<i class=${cls}>${escape(text)}</i>` : escape(text),
          )
          .join('');
      });
      while (lines.length < want) lines.push('');
      return lines.slice(0, want);
    } catch {
      // A malformed grammar or pathological source must remain readable.
      return plain(source, want);
    }
  };
}
