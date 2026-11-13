// typescript-eslint needs the TypeScript JS API, which the native TypeScript 7 does not ship
// until 7.1. Its parser and helpers get the TypeScript 6 pinned beside this file instead, while
// the project's tsc stays the native compiler.
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const typescript6 = pathToFileURL(createRequire(import.meta.url).resolve('typescript')).href;
const parsers = /\/node_modules\/(@typescript-eslint\/|typescript-eslint\/|ts-api-utils\/)/;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'typescript' && parsers.test(context.parentURL || ''))
      return { url: typescript6, format: 'commonjs', shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const { default: tseslint } = await import('typescript-eslint');
export default tseslint;
