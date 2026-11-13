import { createResource, Show } from 'solid-js';
import { createResourceRequest } from '../lib/resource-request.js';
import { Popover } from '../lib/Popover.jsx';
export function CommitDetails(props) {
  return <Popover label="Commit details">{() => <Details sha={props.sha} />}</Popover>;
}
function Details(props) {
  const request = createResourceRequest();
  const [detail] = createResource(
    () => props.sha,
    (sha) => request('api/commitdetail', { sha }),
  );
  return (
    <>
      <Show when={detail.error}>
        <p role="alert">{detail.error.message}</p>
      </Show>
      <Show
        when={!detail.error && detail()}
        fallback={
          <Show when={!detail.error}>
            <p>Loading…</p>
          </Show>
        }
      >
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
    </>
  );
}
