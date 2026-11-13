import { createEffect, createSignal } from 'solid-js';
import { render } from '@solidjs/testing-library';
import { test, expect, vi } from 'vitest';
import { createEventStream } from './events.ts';

function mockSource() {
  let stream;
  class Source {
    constructor() {
      stream = this;
      this.handlers = {};
    }
    addEventListener(name, handler) {
      this.handlers[name] = handler;
    }
    close = vi.fn();
  }
  vi.stubGlobal('EventSource', Source);
  return () => stream;
}

test('stream handlers run synchronously and batch their signal updates', () => {
  const source = mockSource();
  const observed = vi.fn();
  const called = vi.fn();
  function Consumer() {
    const [first, setFirst] = createSignal(0);
    const [second, setSecond] = createSignal(0);
    createEffect(() => observed(first() + second()));
    createEventStream('api/stream', {
      state(data) {
        called(data);
        setFirst(data.first);
        setSecond(data.second);
      },
    });
    return null;
  }
  try {
    const view = render(() => <Consumer />);
    expect(observed).toHaveBeenCalledExactlyOnceWith(0);
    source().handlers.state({ data: '{"first":2,"second":3}' });
    expect(called).toHaveBeenCalledExactlyOnceWith({ first: 2, second: 3 });
    expect(observed.mock.calls).toEqual([[0], [5]]);
    view.unmount();
    expect(source().close).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});

test('stream failures report synchronously and malformed JSON is ignored', () => {
  const source = mockSource();
  const report = vi.fn();
  const failure = new Error('handler failed');
  function Consumer() {
    createEventStream(
      'api/stream',
      {
        state() {
          throw failure;
        },
      },
      { onError: report },
    );
    return null;
  }
  try {
    render(() => <Consumer />);
    source().handlers.state({ data: 'bad' });
    expect(report).not.toHaveBeenCalled();
    source().handlers.state({ data: '{}' });
    expect(report).toHaveBeenCalledExactlyOnceWith(failure);
  } finally {
    vi.unstubAllGlobals();
  }
});
