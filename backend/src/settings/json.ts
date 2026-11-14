import { parse } from '../decode.ts';
// Go's decoder wording is part of the existing settings HTTP response.
export function parseSettings(text: string): Record<string, unknown> {
  try {
    return parse(text);
  } catch (error) {
    if (
      error instanceof SyntaxError &&
      (/end|EOF|unterminated/i.test(error.message) || /[{[,]\s*$/.test(text))
    )
      throw new Error('unexpected end of JSON input');
    throw error;
  }
}
