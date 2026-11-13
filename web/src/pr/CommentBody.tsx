import type { PRComment } from './types.ts';

interface CommentBodyProps {
  comment: Pick<PRComment, 'body' | 'bodyHtml'>;
}
import type { JSX } from 'solid-js';
import { createMemo, Show } from 'solid-js';
import { Markdown } from '../lib/Markdown.tsx';
import { commentFragment } from './comment-dom.ts';
// Posted comments use the forge's rendered Markdown, sanitized; drafts use the thread renderer.
export function CommentBody(props: CommentBodyProps): JSX.Element {
  const fragment = createMemo(() =>
    props.comment.bodyHtml ? commentFragment(props.comment.bodyHtml) : null,
  );
  return (
    <div class="thr-body pr-md min-w-0 text-sm leading-relaxed wrap-anywhere">
      <Show when={fragment()} fallback={<Markdown text={props.comment.body || ''} />}>
        {fragment()}
      </Show>
    </div>
  );
}
