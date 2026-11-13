import { createResource, Show } from 'solid-js';
import { api } from '../lib/api.js';
import { Popover } from '../lib/Popover.jsx';
export function CommitDetails(props) {
  return <Popover label="Commit details">{() => <Details sha={props.sha} />}</Popover>;
}
function Details(props) {
  const [detail] = createResource(
    () => props.sha,
    (sha) => api('api/commitdetail', { sha }),
  );
  return (
    <Show when={!detail.error && detail()} fallback={<p>Loading…</p>}>
      {(data) => (
        <div class="max-h-80 w-72 overflow-auto p-2">
          <p>
            {data().author} · {data().date}
          </p>
          <Show when={data().authorUrl}>
            <a href={data().authorUrl} target="_blank" rel="noopener">
              Author profile
            </a>
          </Show>
          <pre class="whitespace-pre-wrap">{data().message || data().subject}</pre>
          <p>
            {data().files || 0} files · +{data().insertions || 0} −{data().deletions || 0}
          </p>
          <button class="btn" onClick={() => void navigator.clipboard.writeText(props.sha)}>
            Copy SHA
          </button>
        </div>
      )}
    </Show>
  );
}
