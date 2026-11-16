// Run against built app.css and the actual served themes in a real browser.
// No dependencies, remote requests, settings writes or agent execution.
document.documentElement.style.setProperty('--flat-shadow', '0 0 #0000');
const fixtures = document.getElementById('fixtures');
const results = [];
window.fiboShapeResults = results;
function check(name, actual, expected) {
  const passed = actual === expected;
  results.push({ name, actual, expected, passed });
}
function mount(markup) {
  fixtures.innerHTML = markup;
  // Assert final styles, independently of the browser's animation clock.
  for (const element of fixtures.querySelectorAll('*')) element.style.transition = 'none';
  return fixtures.firstElementChild;
}
function style(element) {
  return getComputedStyle(element);
}
function token(property, value) {
  const probe = document.createElement('span');
  probe.style.setProperty(property, `var(${value})`);
  fixtures.append(probe);
  const resolved = style(probe).getPropertyValue(property);
  probe.remove();
  return resolved;
}
function shadow(element, expected, name) {
  const actual = style(element).getPropertyValue('--tw-shadow').trim();
  const probe = document.createElement('span');
  probe.style.boxShadow = actual;
  fixtures.append(probe);
  const resolved = token('box-shadow', expected);
  check(name, style(probe).boxShadow, resolved);
  if (expected !== '--flat-shadow')
    check(`${name} painted shadow`, style(element).boxShadow.includes(resolved), true);
  probe.remove();
}
function corners(element) {
  const s = style(element);
  return [
    s.borderTopLeftRadius,
    s.borderTopRightRadius,
    s.borderBottomRightRadius,
    s.borderBottomLeftRadius,
  ].join(' ');
}
for (const theme of ['fibo-light', 'fibo-dark']) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('dark', theme.endsWith('dark'));
  const test = (name, actual, expected) => check(`${theme}: ${name}`, actual, expected);
  for (const [name, radius] of Object.entries({
    sm: 6,
    md: 10,
    lg: 14,
    xl: 20,
    '2xl': 24,
    pill: 999,
  })) {
    test(
      `radius-${name} token`,
      style(document.documentElement).getPropertyValue(`--radius-${name}`).trim(),
      `${radius}px`,
    );
  }
  for (const size of ['', 'default', 'xs', 'sm', 'lg', 'icon-xs', 'icon-sm', 'icon', 'icon-lg']) {
    const button = mount(
      `<button class="btn" ${size ? `data-size="${size}"` : ''}>Action</button>`,
    );
    test(`button ${size || 'unsized'} radius`, style(button).borderRadius, '999px');
    shadow(button, '--flat-shadow', `${theme}: button ${size || 'unsized'} flat`);
    if (size.startsWith('icon'))
      test(`button ${size} square bounds`, style(button).width, style(button).height);
  }
  for (const vertical of [false, true]) {
    for (const rtl of [false, true]) {
      const group = mount(
        `<div class="button-group" dir="${rtl ? 'rtl' : 'ltr'}" ${vertical ? 'data-orientation="vertical"' : ''}><button class="btn" data-size="xs">First</button><button class="btn" data-size="sm">Middle</button><button class="btn" data-size="icon-xs">Last</button></div>`,
      );
      test(
        `group ${vertical ? 'vertical' : 'horizontal'} ${rtl ? 'rtl' : 'ltr'} first`,
        corners(group.children[0]),
        vertical ? '14px 14px 0px 0px' : rtl ? '0px 999px 999px 0px' : '999px 0px 0px 999px',
      );
      test('group square middle seams', corners(group.children[1]), '0px 0px 0px 0px');
      test(
        'group outer last ends',
        corners(group.children[2]),
        vertical ? '0px 0px 14px 14px' : rtl ? '999px 0px 0px 999px' : '0px 999px 999px 0px',
      );
    }
    const one = mount(
      `<div class="button-group" ${vertical ? 'data-orientation="vertical"' : ''}><button class="btn" data-size="xs">Only</button></div>`,
    );
    test('single group child pill', corners(one.firstElementChild), '999px 999px 999px 999px');
    const wrapped = mount(
      `<div class="button-group" ${vertical ? 'data-orientation="vertical"' : ''}><button class="btn">First</button><div class="dropdown-menu"><button class="btn">Last</button></div></div>`,
    );
    test(
      'wrapped group trigger',
      corners(wrapped.querySelector('.dropdown-menu .btn')),
      vertical ? '0px 0px 14px 14px' : '0px 999px 999px 0px',
    );
  }
  const pressed = mount(
    '<div class="button-group"><button class="btn" aria-pressed="true">On</button><button class="btn" aria-pressed="false">Off</button></div>',
  );
  test(
    'pressed group fill',
    style(pressed.children[0]).backgroundColor,
    token('background-color', '--accent'),
  );
  test('pressed group ink', style(pressed.children[0]).color, token('color', '--foreground'));
  test(
    'unpressed group ink',
    style(pressed.children[1]).color,
    token('color', '--muted-foreground'),
  );
  const special = mount('<button class="btn" data-variant="special">Explain</button>');
  test('special fill', style(special).backgroundColor, token('background-color', '--periwinkle'));
  test('special ink', style(special).color, token('color', '--on-pastel'));
  special.setAttribute('aria-expanded', 'true');
  // Disable transitions so this checks the final expanded colour.
  special.style.transition = 'none';
  const mix = document.createElement('span');
  mix.style.backgroundColor = 'color-mix(in oklab, var(--periwinkle) 82%, var(--ink))';
  fixtures.append(mix);
  test('special expanded fill', style(special).backgroundColor, style(mix).backgroundColor);
  special.disabled = true;
  test('special disabled opacity', style(special).opacity, '0.5');
  test('special disabled pointer events', style(special).pointerEvents, 'none');
  for (const [tone, fill] of Object.entries({
    brand: 'pistachio',
    agent: 'periwinkle',
    added: 'aqua',
    waiting: 'lemon',
    file: 'bubblegum',
  })) {
    const badge = mount(`<span class="badge" data-tone="${tone}">${tone}</span>`);
    test(`badge ${tone} radius`, style(badge).borderRadius, '999px');
    test(
      `badge ${tone} fill`,
      style(badge).backgroundColor,
      token('background-color', `--${fill}`),
    );
    test(`badge ${tone} ink`, style(badge).color, token('color', '--on-pastel'));
    test(`badge ${tone} border`, style(badge).borderTopColor, 'rgba(0, 0, 0, 0)');
  }
  for (const component of ['btn', 'badge']) {
    const link = mount(`<a href="#" class="${component}" data-variant="link">Open</a>`);
    test(`${component} link ink`, style(link).color, token('color', '--primary-text'));
  }
  const tonedLink = mount(
    '<a href="#" class="badge" data-variant="link" data-tone="file">File link</a>',
  );
  test('toned badge link ink', style(tonedLink).color, token('color', '--primary-text'));
  for (const type of ['checkbox', 'radio']) {
    const input = mount(`<input class="input" type="${type}" checked>`);
    test(`checked ${type} edge`, style(input).borderColor, token('border-color', '--spiral'));
    const field = mount(
      `<div class="field"><input type="${type}" checked aria-invalid="true"></div>`,
    );
    test(
      `field checked invalid ${type} edge`,
      style(field.firstElementChild).borderColor,
      token('border-color', '--spiral'),
    );
  }
  const switchControl = mount('<input class="input" type="checkbox" role="switch" checked>');
  test('checked switch edge', style(switchControl).borderColor, token('border-color', '--spiral'));
  for (const markup of [
    '<button class="btn">Focus</button>',
    '<div class="tabs"><nav role="tablist"><button role="tab" aria-selected="true">Focus</button></nav></div>',
    '<input class="input" type="checkbox">',
    '<div class="field"><input type="radio"></div>',
    '<div class="tr" tabindex="0">Tree row</div>',
    '<button class="tn">Editor tab</button>',
    '<button data-control="note-summary">Note summary</button>',
    '<button id="explain-orb-open" class="btn">Explain</button>',
  ]) {
    const root = mount(markup);
    const control = root.matches('button,input,[tabindex]')
      ? root
      : root.querySelector('button,input');
    control.focus();
    test(`${control.outerHTML} focus visible`, control.matches(':focus-visible'), true);
    test('focus outline width', style(control).outlineWidth, '2px');
    test('focus outline style', style(control).outlineStyle, 'solid');
    test('focus outline offset', style(control).outlineOffset, '2px');
    test('focus outline colour', style(control).outlineColor, token('color', '--focus'));
    test(
      'focus ring cleared',
      style(control).getPropertyValue('--tw-ring-shadow').trim(),
      '0 0 transparent',
    );
  }
  const tabs = mount(
    '<div class="tabs"><nav role="tablist"><button role="tab" aria-selected="true">Selected</button></nav></div>',
  );
  shadow(tabs.querySelector('button'), '--shadow-raise', `${theme}: selected tab`);
  const dialog = mount(
    '<dialog class="dialog" open><section><div class="popover"><div data-popover>Nested</div></div><div class="card shadow-pop">Nested card</div><div class="tabs"><nav role="tablist"><button role="tab" aria-selected="true">Nested tab</button></nav></div></section></dialog>',
  );
  shadow(dialog.firstElementChild, '--shadow-dialog', `${theme}: dialog elevation`);
  for (const element of dialog.querySelectorAll('[data-popover],.card,[role="tab"]'))
    shadow(element, '--flat-shadow', `${theme}: flat dialog child ${element.className}`);
  const command = mount(
    '<dialog class="command-dialog" open><div class="command">Commands</div></dialog>',
  );
  test('command palette radius', style(command.firstElementChild).borderRadius, '20px');
  shadow(command.firstElementChild, '--shadow-dialog', `${theme}: command palette elevation`);
  for (const markup of [
    '<div data-popover>Popover</div>',
    '<div class="dropdown-menu"><div data-popover>Menu</div></div>',
    '<div class="select"><div data-popover>Select</div></div>',
    '<div class="toast-content">Toast</div>',
  ]) {
    const root = mount(markup);
    shadow(
      root.querySelector('[data-popover]') || root,
      '--shadow-pop',
      `${theme}: floating surface ${root.className}`,
    );
  }
  const utility = mount('<button class="btn rounded-md" data-size="xs">Explicit utility</button>');
  test('utility layer overrides compact button radius', style(utility).borderRadius, '10px');
}
// Legacy user themes omit every new token. Exercise the app root fallbacks.
document.documentElement.dataset.theme = 'legacy-fixture';
document.documentElement.classList.remove('dark');
const legacy = mount('<button class="btn" data-variant="special">Explain</button>');
const legacyStyle = document.createElement('style');
legacyStyle.textContent =
  ':root[data-theme="legacy-fixture"] { --special: #4545a0; --nf: #4545a0; --background: #fff; --foreground: #111; --primary: #ddd; --primary-text: #333; --gi: #176b50; --warn: #665500; --sel: #ddbbcc; --shadow: 0 2px 4px #0003; }';
document.head.append(legacyStyle);
check(
  'legacy special fill resolves',
  style(legacy).backgroundColor,
  token('background-color', '--periwinkle'),
);
check('legacy on-pastel fallback', style(legacy).color, 'rgb(17, 17, 17)');
check('legacy spiral fallback', token('color', '--spiral'), 'rgb(51, 51, 51)');
check(
  'legacy shadow fallback',
  token('box-shadow', '--shadow-pop'),
  token('box-shadow', '--shadow'),
);
legacyStyle.remove();
const failures = results.filter((result) => !result.passed);
document.getElementById('result').textContent =
  `${results.length - failures.length}/${results.length} assertions passed`;
document.documentElement.dataset.result = failures.length ? 'failed' : 'passed';
if (failures.length) throw new Error(JSON.stringify(failures));
