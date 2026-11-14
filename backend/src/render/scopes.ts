// Ordered, explicit TextMate scope -> Chroma classFor vocabulary. Most specific
// scopes win within the deepest scope in a token's stack. Unclassified names
// remain unstyled, matching Go's plain Name tokens. Never emit theme colors.
export const classes = new Set([
  'kt',
  'na',
  'nt',
  'nd',
  'nc',
  'no',
  'np',
  'err',
  'gi',
  'gd',
  'gh',
  'ge',
  'gs',
  'k',
  'nf',
  'nv',
  'nb',
  's',
  'm',
  'o',
  'p',
  'cp',
  'c',
  'g',
]);
export const scopeClasses: readonly (readonly [string, string])[] = [
  ['invalid', 'err'],
  ['comment.line.preprocessor', 'cp'],
  ['meta.preprocessor', 'cp'],
  ['comment', 'c'],
  ['punctuation.definition.comment', 'c'],
  ['entity.name.function.decorator', 'nd'],
  ['entity.name.tag', 'nt'],
  ['entity.other.attribute-name', 'na'],
  ['entity.name.type', 'nc'],
  ['entity.name.class', 'nc'],
  ['entity.name.namespace', 'nc'],
  ['entity.name.function', 'nf'],
  ['support.function', 'nb'],
  ['support.type', 'kt'],
  ['storage.type', 'k'],
  ['storage.modifier', 'k'],
  ['keyword.operator', 'o'],
  ['keyword', 'k'],
  ['constant.numeric', 'm'],
  ['constant.language', 'k'],
  ['constant.character', 's'],
  ['constant.other', 'no'],
  ['string', 's'],
  ['punctuation.definition.string', 's'],
  ['variable.language', 'nb'],
  ['variable.other.constant', 'no'],
  ['variable.parameter', 'nv'],
  ['variable', ''],
  ['markup.inserted', 'gi'],
  ['markup.deleted', 'gd'],
  ['markup.heading', 'gh'],
  ['markup.bold', 'gs'],
  ['markup.italic', 'ge'],
  ['markup.inline.raw', 's'],
  ['punctuation', 'p'],
];
export function classFor(scopes: readonly string[], language = ''): string {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i] ?? '';
    if (language === 'Go') {
      if (
        scope.startsWith('storage.type') &&
        /\b(?:int|uint|float|complex|bool|string|byte|rune|error|any|uintptr)/.test(scope)
      )
        return 'kt';
      if (scope.startsWith('comment.line.double-slash')) return 'c';
    }
    for (const [prefix, cls] of scopeClasses)
      if (scope === prefix || scope.startsWith(prefix + '.')) return cls;
  }
  return '';
}
