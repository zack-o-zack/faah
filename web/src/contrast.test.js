import { resolve } from 'node:path';
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';

function luminance(hex) {
  let value = hex.slice(1);
  if (value.length === 3) value = [...value].map(c=>c+c).join('');
  return [0,2,4].map(i=>parseInt(value.slice(i,i+2),16)/255)
    .map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4)
    .reduce((sum,c,i)=>sum+c*[0.2126,0.7152,0.0722][i],0);
}
function contrast(a,b) {
  const [low,high]=[luminance(a),luminance(b)].sort((a,b)=>a-b);
  return (high+0.05)/(low+0.05);
}

for (const theme of ['catppuccin-mocha','light','dracula','solarized-light','github-dark']) {
  test(`${theme} keeps UI text, syntax and control edges legible on audited surfaces`, () => {
    const css=readFileSync(resolve('web/themes', `${theme}.css`),'utf8');
    const tokens=Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[\da-f]+);/gi)].map(m=>[m[1],m[2]]));
    for (const surface of ['background','sidebar','popover','accent']) {
      for (const text of ['foreground','muted-foreground','faint','primary-text','warn','destructive','gi','gd','k','kt','nf','nc','nb','nv','no','na','nt','nd','np','s','m','o','p','c','cp']) {
        expect(contrast(tokens[text],tokens[surface]),`${theme}: ${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(tokens.input,tokens[surface]),`${theme}: input on ${surface}`).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(tokens.primary,tokens['primary-foreground'])).toBeGreaterThanOrEqual(4.5);
  });
}

// Filled primary actions must be readable in every bundled theme, including
// the theme selected by an unseeded workbench detector session.
import { readdirSync } from 'node:fs';
test('every bundled theme supplies accessible filled primary actions', () => {
  for (const file of readdirSync(resolve('web/themes')).filter(f=>f.endsWith('.css'))) {
    const css=readFileSync(resolve('web/themes', file),'utf8');
    const tokens=Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[\da-f]+);/gi)].map(m=>[m[1],m[2]]));
    expect(contrast(tokens.primary,tokens['primary-foreground']),file).toBeGreaterThanOrEqual(4.5);
  }
});
