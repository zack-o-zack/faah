import type { LanguageRegistration } from 'shiki';
type IRawRule = LanguageRegistration['patterns'][number];
import { record, string } from '../decode.ts';

function rules(value: unknown): Record<string, IRawRule> {
  return Object.fromEntries(
    Object.entries(record(value)).map(([key, value]) => [key, rule(value)]),
  );
}
// TextMate capture dictionaries may contain metadata alongside numeric groups.
// Only numeric keys identify capture rules.
function captures(value: unknown): Record<string, IRawRule> {
  return Object.fromEntries(
    Object.entries(Array.isArray(value) ? value : record(value))
      .filter(([key]) => /^\d+$/.test(key))
      .map(([key, value]) => [key, typeof value === 'string' ? { name: value } : rule(value)]),
  );
}
function rule(value: unknown): IRawRule {
  const v = Array.isArray(value) ? {} : record(value);
  return {
    ...Object.fromEntries(
      ['include', 'name', 'contentName', 'match', 'begin', 'end', 'while'].flatMap((key) =>
        v[key] === undefined ? [] : [[key, string(v[key])]],
      ),
    ),
    ...(v.patterns === undefined ? {} : { patterns: list(v.patterns).map(rule) }),
    ...(v.repository === undefined ? {} : { repository: rules(v.repository) }),
    ...(v.captures === undefined ? {} : { captures: captures(v.captures) }),
    ...(v.beginCaptures === undefined ? {} : { beginCaptures: captures(v.beginCaptures) }),
    ...(v.endCaptures === undefined ? {} : { endCaptures: captures(v.endCaptures) }),
    ...(v.whileCaptures === undefined ? {} : { whileCaptures: captures(v.whileCaptures) }),
    ...(v.applyEndPatternLast === undefined
      ? {}
      : { applyEndPatternLast: Boolean(v.applyEndPatternLast) }),
  };
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('invalid grammar array');
  return value;
}
export function decodeGrammars(value: unknown): LanguageRegistration[] {
  return list(value).map((value) => {
    const v = record(value);
    return {
      name: string(v.name),
      scopeName: string(v.scopeName),
      patterns: list(v.patterns).map(rule),
      repository: v.repository === undefined ? {} : rules(v.repository),
      ...(v.injections === undefined ? {} : { injections: rules(v.injections) }),
      ...Object.fromEntries(
        ['injectionSelector', 'firstLineMatch', 'displayName'].flatMap((key) =>
          v[key] === undefined ? [] : [[key, string(v[key])]],
        ),
      ),
      ...Object.fromEntries(
        [
          'aliases',
          'embeddedLangs',
          'embeddedLanguages',
          'embeddedLangsLazy',
          'balancedBracketSelectors',
          'unbalancedBracketSelectors',
          'fileTypes',
          'injectTo',
        ].flatMap((key) =>
          v[key] === undefined ? [] : [[key, list(v[key]).map((value) => string(value))]],
        ),
      ),
    };
  });
}
