/** Drop the subject, join prose lines, and preserve paragraphs, lists and indentation. */
export function commitMessageBody(message: string): string {
  const lines = message.replace(/\r\n?/g, '\n').split('\n').slice(1);
  while (lines.length && !lines[0]?.trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1]?.trim()) lines.pop();
  const result: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) result.push(paragraph.join(' '));
    paragraph = [];
  };
  for (const line of lines) {
    if (!line.trim()) {
      flush();
      result.push('');
    } else if (/^(?:\s|[-*•](?:\s|$)|\d+\.(?:\s|$))/.test(line)) {
      flush();
      result.push(line.trimEnd());
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  return result.join('\n');
}

export function authorInitial(author: string): string {
  return Array.from(author.trim())[0]?.toLocaleUpperCase() ?? '?';
}
