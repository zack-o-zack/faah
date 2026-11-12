import { test, expect } from 'vitest';
import { makeCardKeeper } from './cardkeep.js';

test('pointer departure keeps a documentation card open while keyboard focus is inside', async () => {
  const oldDocument = globalThis.document;
  const oldListen = globalThis.addEventListener;
  const listeners = {};
  const focused = {};
  let hides = 0;
  globalThis.document = { activeElement: focused, addEventListener() {} };
  globalThis.addEventListener = () => {};
  const card = {
    hidden: false,
    contains: node => node === focused,
    getBoundingClientRect: () => ({left:100,right:200,top:100,bottom:200}),
    addEventListener: (name, fn) => { listeners[name] = fn; },
  };
  try {
    const keeper = makeCardKeeper(card, {hide:()=>hides++,grace:5});
    keeper.open({x:100,y:100});
    keeper.tick();
    await new Promise(resolve=>setTimeout(resolve,15));
    expect(hides).toBe(0);
    document.activeElement = null;
    listeners.focusout();
    await new Promise(resolve=>setTimeout(resolve,15));
    expect(hides).toBe(1);
    keeper.close();
    card.hidden = true;
  } finally {
    globalThis.document = oldDocument;
    globalThis.addEventListener = oldListen;
  }
});
