import type MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

function inlineText(tokens: readonly Token[]): string {
  return tokens
    .map((token) => {
      if (token.children) return inlineText(token.children);
      if (['text', 'text_special', 'code_inline'].includes(token.type)) return token.content;
      return token.type === 'softbreak' ? '\n' : '';
    })
    .join('');
}

export function goldmarkText(md: MarkdownIt): void {
  // Goldmark treats only LF as a line boundary. CRLF is normalized by the caller.
  md.core.ruler.at('normalize', (state) => {
    state.src = state.src.replace(/\0/g, '\uFFFD');
  });
  md.renderer.renderInlineAsText = (tokens) => inlineText(tokens);
}
