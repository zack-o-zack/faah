import { test, expect } from 'bun:test';
import { ownsNavigationKey } from './controls.js';

test('focused controls retain navigation and activation without taking editor shortcuts', () => {
  const control = { closest: () => ({}) };
  for (const key of ['ArrowDown', 'ArrowLeft', 'Home', 'End', ' ', 'Enter']) {
    expect(ownsNavigationKey({ key, target: control })).toBe(true);
    expect(ownsNavigationKey({ key, target: control, metaKey: true })).toBe(false);
    expect(ownsNavigationKey({ key, target: control, ctrlKey: true })).toBe(false);
    expect(ownsNavigationKey({ key, target: control, altKey: true })).toBe(false);
  }
  expect(ownsNavigationKey({key:'Escape',target:control})).toBe(false);
  expect(ownsNavigationKey({key:'ArrowDown',target:{closest:()=>null}})).toBe(false);
});
