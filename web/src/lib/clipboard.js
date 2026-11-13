import { toast } from './toast.jsx';
export async function copyText(text, message = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast('success', message);
    return true;
  } catch (error) {
    toast('error', error.message);
    return false;
  }
}
export async function copyRich(text, html, message = 'Copied formatted text') {
  try {
    if (html && typeof ClipboardItem !== 'undefined')
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
    else await navigator.clipboard.writeText(text);
    toast('success', message);
  } catch (error) {
    toast('error', error.message);
  }
}
