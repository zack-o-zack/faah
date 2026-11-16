import { createEffect, createSignal, onCleanup } from 'solid-js';

/** Leave enough room to read the diff beside the measured explanation card. */
export function createWalkPadding(
  pane: () => HTMLElement | undefined,
  active: () => boolean,
  cardElement: () => HTMLElement | undefined,
) {
  const [padding, setPadding] = createSignal(0);
  createEffect(() => {
    const container = pane();
    const card = cardElement();
    if (!active() || !container || !card) {
      setPadding(0);
      return;
    }
    const measure = () => {
      const width = card.getBoundingClientRect().width + 8;
      setPadding(container.clientWidth - width - 24 >= 360 ? width : 0);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    observer.observe(container);
    measure();
    onCleanup(() => observer.disconnect());
  });
  return padding;
}
