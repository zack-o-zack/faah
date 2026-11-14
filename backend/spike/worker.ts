import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import typescript from 'shiki/langs/typescript.mjs';
import theme from 'shiki/themes/github-dark.mjs';
const highlighter = await createHighlighterCore({
  themes: [theme],
  langs: [typescript],
  engine: createJavaScriptRegexEngine(),
});
self.postMessage(
  highlighter.codeToHtml('const answer: number = 42', { lang: 'typescript', theme: 'github-dark' }),
);
