import { toast } from './toast.tsx';
export async function copyText(text: string, message = 'Copied'): Promise<boolean> {
  try {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(text);
    } catch {
      const previous = document.activeElement;
      const selection = document.getSelection();
      const ranges = selection
        ? Array.from({ length: selection.rangeCount }, (_, index) =>
            selection.getRangeAt(index).cloneRange(),
          )
        : [];
      const input = document.createElement('textarea');
      input.value = text;
      input.style.cssText = 'position:fixed;top:-9999px;left:-9999px';
      document.body.append(input);
      try {
        input.select();
        if (!document.execCommand('copy')) throw new Error('Could not copy to clipboard');
      } finally {
        input.remove();
        if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
        selection?.removeAllRanges();
        for (const range of ranges) selection?.addRange(range);
      }
    }
    toast('success', message);
    return true;
  } catch (error) {
    toast('error', error instanceof Error ? error.message : String(error));
    return false;
  }
}
export async function copyRich(
  text: string,
  html: string,
  message = 'Copied formatted text',
): Promise<boolean> {
  try {
    if (html && typeof ClipboardItem !== 'undefined')
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
    else return copyText(text, message);
    toast('success', message);
    return true;
  } catch {
    return copyText(text, message);
  }
}
