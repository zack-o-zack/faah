import { test, expect } from 'bun:test';

const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, {
    id, value:'', dataset:{}, style:{}, children:[], hidden:true,
    classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    querySelector(){return null;},querySelectorAll(){return [];},
    addEventListener(){},setAttribute(){},getAttribute(){return null;},
    focus(){},setSelectionRange(){},showModal(){},close(){},
  });
  return elements.get(id);
};
globalThis.document = {
  body:element('body'),documentElement:element('html'),baseURI:'http://localhost/',
  querySelector:s=>element(s),querySelectorAll:()=>[],
  createElement:tag=>element(tag),addEventListener(){},
};
globalThis.window=globalThis;
globalThis.location={href:'http://localhost/'};
const { COMMANDS, overlay, palInput, openPalette, closePalette, refreshPaletteNow, acceptPalette } = await import('./palette.js');

// Other browser-module tests can have initialized these exported DOM handles.
overlay.showModal = () => {};
overlay.close = () => {};
palInput.setSelectionRange = () => {};

test('immediate Enter executes the current query rather than the previous command', async () => {
  let oldRuns=0,newRuns=0;
  COMMANDS.push({name:'Audit old command',run:()=>oldRuns++},{name:'Audit new command',run:()=>newRuns++});
  try {
    openPalette('command','>Audit old command');
    await refreshPaletteNow();
    palInput.value='>Audit new command';
    await acceptPalette();
    expect(oldRuns).toBe(0);
    expect(newRuns).toBe(1);
  } finally { COMMANDS.splice(-2); closePalette(); }
});

test('an old file-search reply cannot overwrite a newer query', async () => {
  const originalFetch=globalThis.fetch;
  let resolveOld;
  const oldReply=new Promise(resolve=>{resolveOld=resolve;});
  globalThis.fetch=async url=>({json:async()=>{
    const q=new URL(url).searchParams.get('q');
    if(q==='old')await oldReply;
    return {results:[{path:q+'.go',name:q+'.go'}]};
  }});
  try {
    openPalette('file','old');
    const oldRefresh=refreshPaletteNow();
    palInput.value='new';
    await refreshPaletteNow();
    resolveOld();await oldRefresh;
    const {pal}=await import('./palette.js');
    expect(pal.items[0].path).toBe('new.go');
  } finally { closePalette();globalThis.fetch=originalFetch; }
});
