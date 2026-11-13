import { record, number } from './decode.ts';
import { required } from './test-values.ts';
import { createEffect, createSignal } from 'solid-js';
import { render } from '@solidjs/testing-library';
import { test, expect, vi } from 'vitest';
import { createEventStream } from './events.ts';

function mockSource() {
  const stream: { current?: Source } = {};
  class Source {
    handlers: Record<string, (event: { data: string }) => void> = {};
    emit(name: string, data: string): void {
      required(this.handlers[name])({ data });
    }
    constructor() {
      stream.current = this;
      this.handlers = {};
    }
    addEventListener(name: string, handler: (event: { data: string }) => void) {
      this.handlers[name] = handler;
    }
    close = vi.fn();
  }
  vi.stubGlobal('EventSource', Source);
  return () => required(stream.current);
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
        setFirst(number(record(data).first));
        setSecond(number(record(data).second));
      },
    });
    return null;
  }
  try {
    const view = render(() => <Consumer />);
    expect(observed).toHaveBeenCalledExactlyOnceWith(0);
    source().emit('state', '{"first":2,"second":3}');
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
    source().emit('state', 'bad');
    expect(report).not.toHaveBeenCalled();
    source().emit('state', '{}');
    expect(report).toHaveBeenCalledExactlyOnceWith(failure);
  } finally {
    vi.unstubAllGlobals();
  }
});
