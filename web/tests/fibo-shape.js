// Run against built app.css and the actual served themes in a real browser.
// No dependencies, remote requests, settings writes or agent execution.
document.documentElement.style.setProperty('--flat-shadow', '0 0 transparent');
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
const colorCanvas = document.createElement('canvas');
colorCanvas.width = colorCanvas.height = 1;
const colorContext = colorCanvas.getContext('2d', { willReadFrequently: true });
function contrast(foreground, background) {
  const luminance = (color) => {
    colorContext.clearRect(0, 0, 1, 1);
    colorContext.fillStyle = color;
    colorContext.fillRect(0, 0, 1, 1);
    const channels = [...colorContext.getImageData(0, 0, 1, 1).data].slice(0, 3).map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
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
for (const theme of ['light', 'dark']) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('dark', theme.endsWith('dark'));
  const test = (name, actual, expected) => check(`${theme}: ${name}`, actual, expected);
  for (const heading of ['h2', 'h3']) {
    for (const [name, markup] of [
      [
        'card',
        `<article class="card"><header><${heading}>Card heading</${heading}></header></article>`,
      ],
      [
        'dialog',
        `<dialog class="dialog" open><section><header><${heading}>Dialog heading</${heading}></header></section></dialog>`,
      ],
      ['empty', `<div class="empty"><header><${heading}>Empty heading</${heading}></header></div>`],
    ]) {
      const root = mount(markup);
      const title = root.querySelector(heading);
      test(
        `${name} ${heading} display family`,
        style(title).fontFamily,
        token('font-family', '--font-display'),
      );
      test(`${name} ${heading} display weight`, style(title).fontWeight, '600');
      test(
        `${name} ${heading} display tracking`,
        style(title).letterSpacing,
        `${parseFloat(style(title).fontSize) * -0.01}px`,
      );
    }
  }
  const headingUtility = mount(
    '<article class="card"><header><h2 class="font-sans">Explicit sans heading</h2></header></article>',
  );
  test(
    'heading font utility wins',
    style(headingUtility.querySelector('h2')).fontFamily,
    token('font-family', '--ui'),
  );
  const key = mount('<kbd class="kbd">Esc</kbd>');
  test('keyboard key uses UI family', style(key).fontFamily, token('font-family', '--ui'));
  test('keyboard cap height', style(key).height, '22px');
  test('keyboard cap minimum width', style(key).minWidth, '22px');
  test('keyboard cap text size', style(key).fontSize, '12px');
  test('keyboard cap weight', style(key).fontWeight, '500');
  test('keyboard cap radius', style(key).borderRadius, '6px');
  test(
    'keyboard cap text contrast',
    contrast(style(key).color, style(key).backgroundColor) >= 4.5,
    true,
  );
  const shortcut = mount(
    '<div class="dropdown-menu"><button role="menuitem"><span>Search</span><span data-control="shortcut" data-shortcut class="inline-flex gap-1"><kbd class="kbd" data-single>⌘</kbd><kbd class="kbd" data-single>F</kbd></span></button></div>',
  );
  const slot = shortcut.querySelector('[data-shortcut]');
  test('menu shortcut slot spacing', style(slot).paddingInlineStart, '32px');
  for (const cap of shortcut.querySelectorAll('kbd')) {
    test(`menu ${cap.textContent} cap width`, style(cap).width, '22px');
    test(`menu ${cap.textContent} cap padding`, style(cap).paddingInlineStart, '0px');
    test(`menu ${cap.textContent} cap margin`, style(cap).margin, '0px');
  }
  const buttonKey = mount(
    '<div class="dropdown-menu"><button class="btn"><span data-control="shortcut" class="inline-flex gap-1"><kbd class="kbd bg-current/15 text-current" data-variant="button" data-single>↩</kbd></span></button></div>',
  );
  test('button cap height', style(buttonKey.querySelector('kbd')).height, '20px');
  test('button single-glyph cap width', style(buttonKey.querySelector('kbd')).width, '20px');
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
    '<div class="button-group"><button class="btn" data-variant="outline" aria-pressed="true">On</button><button class="btn" data-variant="outline" aria-pressed="false">Off</button></div>',
  );
  test(
    'pressed group fill',
    style(pressed.children[0]).backgroundColor,
    token('background-color', '--foreground'),
  );
  test(
    'group segments share border colour',
    style(pressed.children[0]).borderTopColor,
    style(pressed.children[1]).borderTopColor,
  );
  test('group pressed has border', style(pressed.children[0]).borderTopWidth, '1px');
  test('group off has border', style(pressed.children[1]).borderTopWidth, '1px');
  test('group off has square inner seam', style(pressed.children[1]).borderTopLeftRadius, '0px');
  test('pressed group ink', style(pressed.children[0]).color, token('color', '--background'));
  test(
    'group border uses input token',
    style(pressed.children[0]).borderTopColor,
    token('border-color', '--input'),
  );
  test(
    'pressed group text contrast at least 7:1',
    contrast(style(pressed.children[0]).color, style(pressed.children[0]).backgroundColor) >= 7,
    true,
  );
  test(
    'unpressed group ink',
    style(pressed.children[1]).color,
    token('color', '--muted-foreground'),
  );
  const verdicts = mount(
    '<div class="button-group" role="radiogroup"><button class="btn" data-variant="outline" aria-checked="true">Comment</button><button class="btn" data-variant="outline" aria-checked="false">Approve</button></div>',
  );
  test(
    'selected verdict Ink fill',
    style(verdicts.children[0]).backgroundColor,
    token('background-color', '--foreground'),
  );
  test(
    'selected verdict text contrast',
    contrast(style(verdicts.children[0]).color, style(verdicts.children[0]).backgroundColor) >= 7,
    true,
  );
  test(
    'verdict shared border colour',
    style(verdicts.children[0]).borderTopColor,
    style(verdicts.children[1]).borderTopColor,
  );
  const split = mount(
    '<div class="button-group"><button class="btn" data-variant="outline">Sync</button><div class="dropdown-menu"><button class="btn" data-variant="outline">Menu</button></div></div>',
  );
  for (const button of split.querySelectorAll('button'))
    test(
      'sync outline edge contrast',
      contrast(style(button).borderTopColor, token('background-color', '--background')) >= 3,
      true,
    );
  const special = mount('<button class="btn" data-variant="special">Explain</button>');
  test('special fill', style(special).backgroundColor, token('background-color', '--hover'));
  test('special ink', style(special).color, token('color', '--ink'));
  test('special enabled opacity', style(special).opacity, '1');
  test(
    'special text contrast',
    contrast(style(special).color, style(special).backgroundColor) >= 4.5,
    true,
  );
  special.setAttribute('aria-expanded', 'true');
  // Disable transitions so this checks the final expanded colour.
  special.style.transition = 'none';
  const mix = document.createElement('span');
  mix.style.backgroundColor = 'color-mix(in oklab, var(--hover) 92%, var(--ink))';
  fixtures.append(mix);
  test('special expanded fill', style(special).backgroundColor, style(mix).backgroundColor);
  special.disabled = true;
  test('special disabled opacity', style(special).opacity, '0.5');
  test('special disabled pointer events', style(special).pointerEvents, 'none');
  const send = mount('<button class="btn" data-variant="send">Send</button>');
  test('send fill', style(send).backgroundColor, token('background-color', '--spiral'));
  test('send ink', style(send).color, token('color', '--on-spiral'));
  test('send contrast', contrast(style(send).color, style(send).backgroundColor) >= 4.5, true);
  test('send enabled opacity', style(send).opacity, '1');
  send.disabled = true;
  test('send disabled opacity', style(send).opacity, '0.5');
  test('send disabled pointer events', style(send).pointerEvents, 'none');
  for (const tone of [
    'brand',
    'agent',
    'added',
    'waiting',
    'file',
    'open',
    'merged',
    'closed',
    'draft',
  ]) {
    const badge = mount(`<span class="badge" data-tone="${tone}">${tone}</span>`);
    test(`badge ${tone} radius`, style(badge).borderRadius, '999px');
    const status = {
      open: '--state-open',
      merged: '--state-merged',
      closed: '--state-closed',
      draft: '--state-draft',
    }[tone];
    const fillProbe = document.createElement('span');
    fillProbe.style.backgroundColor = `var(${status || '--surface-sunken'})`;
    fixtures.append(fillProbe);
    test(`badge ${tone} fill`, style(badge).backgroundColor, style(fillProbe).backgroundColor);
    test(`badge ${tone} ink`, style(badge).color, token('color', status ? '--on-state' : '--ink'));
    test(
      `badge ${tone} border`,
      style(badge).borderTopColor,
      token('border-color', status || '--line'),
    );
    fillProbe.remove();
    test(
      `badge ${tone} text contrast`,
      contrast(style(badge).color, style(badge).backgroundColor) >= 4.5,
      true,
    );
  }
  for (const surface of ['--background', '--card', '--sidebar']) {
    for (const variant of ['primary', 'secondary', 'outline', 'destructive', 'ghost', 'link']) {
      const root = mount(
        `<div style="background:var(${surface})"><a class="badge" data-variant="${variant}">Badge</a></div>`,
      );
      const badge = root.firstElementChild;
      const fill =
        style(badge).backgroundColor === 'rgba(0, 0, 0, 0)'
          ? style(root).backgroundColor
          : style(badge).backgroundColor;
      test(
        `badge ${variant} on ${surface} text contrast`,
        contrast(style(badge).color, fill) >= 4.5,
        true,
      );
      if (variant === 'secondary') {
        test(
          'count badge Ink fill',
          style(badge).backgroundColor,
          token('background-color', '--foreground'),
        );
        test('count badge Ink text', style(badge).color, token('color', '--background'));
      }
      if (variant === 'outline')
        test(
          `outline badge edge on ${surface}`,
          contrast(style(badge).borderTopColor, style(root).backgroundColor) >= 3,
          true,
        );
    }
  }
  for (const kind of [
    'func',
    'method',
    'fn',
    'def',
    'defp',
    'class',
    'struct',
    'interface',
    'type',
    'enum',
    'trait',
    'record',
    'protocol',
    'const',
    'var',
    'let',
    'val',
    'module',
    'mod',
    'namespace',
    'defmodule',
    'impl',
    'extension',
    'unknown',
  ]) {
    const badge = mount(
      `<span class="badge" data-variant="secondary" data-k="${kind}">${kind}</span>`,
    );
    test(
      `symbol ${kind} text contrast`,
      contrast(style(badge).color, style(badge).backgroundColor) >= 4.5,
      true,
    );
    test(`symbol ${kind} uses neutral ink`, style(badge).color, token('color', '--ink'));
  }
  const progress = mount(
    '<div class="progress" data-checks><span data-state="passed" style="flex-grow:6"></span><span data-state="skipped" style="flex-grow:1"></span></div>',
  );
  test('check progress height', style(progress).height, '8px');
  test('check progress gap', style(progress).columnGap, '2px');
  test(
    'passed progress fill',
    style(progress.children[0]).backgroundColor,
    token('background-color', '--gi'),
  );
  test(
    'passed progress contrast',
    contrast(style(progress.children[0]).backgroundColor, style(progress).backgroundColor) >= 3,
    true,
  );
  test(
    'skipped progress fill',
    style(progress.children[1]).backgroundColor,
    style(progress).backgroundColor,
  );
  test('skipped progress outline width', style(progress.children[1]).outlineWidth, '1px');
  test(
    'skipped progress outline contrast',
    contrast(style(progress.children[1]).outlineColor, style(progress).backgroundColor) >= 3,
    true,
  );
  test(
    'check progress proportions',
    Math.abs(
      progress.children[0].getBoundingClientRect().width /
        progress.children[1].getBoundingClientRect().width -
        6,
    ) < 0.01,
    true,
  );
  for (const state of ['failed', 'running', 'neutral']) {
    progress.children[0].dataset.state = state;
    const segment = style(progress.children[0]);
    test(
      `${state} progress contrast`,
      contrast(
        state === 'neutral' ? segment.outlineColor : segment.backgroundColor,
        style(progress).backgroundColor,
      ) >= 3,
      true,
    );
  }
  for (const component of ['btn', 'badge']) {
    const link = mount(`<a href="#" class="${component}" data-variant="link">Open</a>`);
    test(`${component} link ink`, style(link).color, token('color', '--link'));
  }
  const tonedLink = mount(
    '<a href="#" class="badge" data-variant="link" data-tone="file">File link</a>',
  );
  test('toned badge link ink', style(tonedLink).color, token('color', '--link'));
  test('toned badge link background', style(tonedLink).backgroundColor, 'rgba(0, 0, 0, 0)');
  test(
    'toned badge link contrast',
    contrast(style(tonedLink).color, token('background-color', '--background')) >= 4.5,
    true,
  );
  const prose = mount(
    '<div class="md"><p><a href="https://example.test" target="_blank">#18</a></p></div>',
  ).querySelector('a');
  test('markdown link ink', style(prose).color, token('color', '--link'));
  test('markdown link keeps an underline', style(prose).textDecorationLine, 'underline');
  test('markdown link has no external icon', getComputedStyle(prose, '::after').content, 'none');
  for (const type of ['checkbox', 'radio']) {
    const input = mount(`<input class="input" type="${type}" checked>`);
    test(`checked ${type} edge`, style(input).borderColor, token('border-color', '--ink'));
    const field = mount(
      `<div class="field"><input type="${type}" checked aria-invalid="true"></div>`,
    );
    test(
      `field checked invalid ${type} edge`,
      style(field.firstElementChild).borderColor,
      token('border-color', '--ink'),
    );
  }
  const switchControl = mount('<input class="input" type="checkbox" role="switch" checked>');
  test('checked switch edge', style(switchControl).borderColor, token('border-color', '--ink'));
  for (const markup of [
    '<button class="btn">Focus</button>',
    '<div class="tabs"><nav role="tablist"><button role="tab" aria-selected="true">Focus</button></nav></div>',
    '<input class="input" type="checkbox">',
    '<input type="checkbox" aria-label="Viewed">',
    '<input type="radio" aria-label="Choice">',
    '<input class="input" type="text">',
    '<textarea class="textarea"></textarea>',
    '<label class="field"><input type="text"></label>',
    '<label class="field"><textarea></textarea></label>',
    '<div class="field"><input type="radio"></div>',
    '<div class="tr" tabindex="0">Tree row</div>',
    '<button class="tn">Editor tab</button>',
    '<button data-control="note-summary">Note summary</button>',
    '<button id="explain-orb-open" class="btn">Explain</button>',
  ]) {
    const root = mount(markup);
    const control = root.matches('button,input,textarea,[tabindex]')
      ? root
      : root.querySelector('button,input,textarea');
    control.focus();
    test(`${control.outerHTML} focus visible`, control.matches(':focus-visible'), true);
    test('focus outline width', style(control).outlineWidth, '2px');
    test('focus outline style', style(control).outlineStyle, 'solid');
    test('focus outline offset', style(control).outlineOffset, '2px');
    test('focus outline colour', style(control).outlineColor, token('color', '--focus'));
    if (control.matches('input,textarea'))
      shadow(control, '--flat-shadow', `${theme}: standalone field stays flat`);
    test(
      'focus ring cleared',
      style(control).getPropertyValue('--tw-ring-shadow').trim(),
      '0 0 transparent',
    );
  }
  // Browsers do not expose ::-webkit-search-cancel-button styles, so find the
  // compiled rule and check which search fields its selector reaches.
  const cancelRule = [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .flatMap((rule) => (rule.cssRules ? [rule, ...rule.cssRules] : [rule]))
    .find((rule) => rule.selectorText?.endsWith('::-webkit-search-cancel-button'));
  test('native search clear rule display', cancelRule?.style.display, 'none');
  for (const custom of [true, false]) {
    const group = mount(
      `<div class="input-group"><input type="search" aria-label="Search" value="query">${custom ? '<button class="btn" data-control="icon-action">Clear</button>' : ''}</div>`,
    );
    test(
      `search ${custom ? 'with' : 'without'} custom clear hides native clear`,
      group
        .querySelector('input')
        .matches(
          cancelRule?.selectorText.replace('::-webkit-search-cancel-button', '') ?? ':not(*)',
        ),
      custom,
    );
  }
  for (const tag of ['input', 'textarea', 'select']) {
    for (const modal of [false, true]) {
      const markup = `<div class="input-group" ${tag === 'textarea' ? 'data-orientation="vertical"' : ''}><${tag} aria-label="Grouped field">${tag === 'select' ? '<option>Choice</option></select>' : tag === 'textarea' ? '</textarea>' : ''}<button class="btn">Open</button></div>`;
      const root = mount(
        modal ? `<dialog class="dialog" open><section>${markup}</section></dialog>` : markup,
      );
      const group = modal ? root.querySelector('.input-group') : root;
      const control = group.querySelector(tag);
      control.focus();
      test(`grouped ${tag} focused`, document.activeElement === control, true);
      test(`grouped ${tag} inner outline`, style(control).outlineStyle, 'none');
      test(`grouped ${tag} inner fill`, style(control).backgroundColor, 'rgba(0, 0, 0, 0)');
      test(`grouped ${tag} inner border`, style(control).borderTopWidth, '0px');
      shadow(control, '--flat-shadow', `${theme}: grouped ${tag} inner control stays flat`);
      test(
        `grouped ${tag} raised fill`,
        style(group).backgroundColor,
        modal ? 'rgba(0, 0, 0, 0)' : token('background-color', '--card'),
      );
      test(`grouped ${tag} focus border`, style(group).borderTopColor, token('color', '--focus'));
      test(`grouped ${tag} no group outline`, style(group).outlineStyle, 'none');
      test(
        `grouped ${tag} no ring`,
        style(group).getPropertyValue('--tw-ring-shadow').trim(),
        '0 0 transparent',
      );
      shadow(group, '--shadow-raise', `${theme}: ${modal ? 'modal ' : ''}grouped ${tag} focus`);
      const button = group.querySelector('button');
      button.focus();
      test('group action keyboard focus', button.matches(':focus-visible'), true);
      test('group action outline', style(button).outlineWidth, '2px');
      test('group action outline style', style(button).outlineStyle, 'solid');
      test('group action outline colour', style(button).outlineColor, token('color', '--focus'));
      shadow(group, '--shadow-raise', `${theme}: group action keeps container focus`);
      button.blur();
      shadow(group, '--flat-shadow', `${theme}: group without focus is flat`);
    }
  }
  const bare = mount('<input type="text" aria-label="Container-owned field">');
  bare.focus();
  test(
    'bare text has no authored outline',
    style(bare).outlineWidth === '2px' && style(bare).outlineStyle === 'solid',
    false,
  );
  const editor = mount('<textarea id="editview-textarea" aria-label="File contents"></textarea>');
  editor.focus();
  test('editor textarea remains chromeless', style(editor).outlineStyle, 'none');
  const viewport = mount(
    '<div id="viewport" class="focus-visible:-outline-offset-2" tabindex="0">Code</div>',
  );
  viewport.focus();
  test('editor viewport keyboard outline', style(viewport).outlineWidth, '2px');
  test('editor viewport inset outline', style(viewport).outlineOffset, '-2px');
  const localStyle = document.createElement('style');
  localStyle.textContent =
    '@layer components { .focus-fixture-local:focus-visible { outline: none; } }';
  document.head.append(localStyle);
  const local = mount('<button class="focus-fixture-local">Locally styled control</button>');
  local.focus();
  test('local component overrides generic focus rule', style(local).outlineStyle, 'none');
  localStyle.remove();
  const tabs = mount(
    '<div class="tabs"><nav role="tablist"><button role="tab" aria-selected="true">Selected</button></nav></div>',
  );
  shadow(tabs.querySelector('button'), '--shadow-raise', `${theme}: selected tab`);
  test(
    'selected rail background',
    style(tabs.querySelector('button')).backgroundColor,
    token('background-color', '--foreground'),
  );
  test(
    'rail muted background',
    style(tabs.querySelector('nav')).backgroundColor,
    token('background-color', '--muted'),
  );
  test(
    'selected rail ink',
    style(tabs.querySelector('button')).color,
    token('color', '--background'),
  );
  test(
    'rail continuous border colour',
    style(tabs.querySelector('nav')).borderTopColor,
    token('border-color', '--input'),
  );
  test('rail continuous border width', style(tabs.querySelector('nav')).borderTopWidth, '1px');
  test(
    'selected rail text contrast at least 7:1',
    contrast(
      style(tabs.querySelector('button')).color,
      style(tabs.querySelector('button')).backgroundColor,
    ) >= 7,
    true,
  );
  for (const [size, height] of [
    ['xs', '24px'],
    ['sm', '32px'],
  ]) {
    tabs.dataset.size = size;
    test(`compact rail ${size} height`, style(tabs.querySelector('nav')).height, height);
  }
  const dialog = mount(
    '<dialog class="dialog" open><section><div class="popover"><div data-popover>Nested</div></div><div class="card shadow-pop">Nested card</div><div class="tabs"><nav role="tablist"><button role="tab" aria-selected="true">Nested tab</button></nav></div></section></dialog>',
  );
  shadow(dialog.firstElementChild, '--shadow-dialog', `${theme}: dialog elevation`);
  for (const element of dialog.querySelectorAll('[data-popover],.card'))
    shadow(element, '--flat-shadow', `${theme}: flat dialog child ${element.className}`);
  shadow(dialog.querySelector('[role="tab"]'), '--shadow-raise', `${theme}: selected dialog tab`);
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
  for (const [level, blur, alpha] of [
    ['off', 0, 1],
    ['subtle', 16, 0.92],
    ['strong', 28, 0.82],
  ]) {
    document.documentElement.dataset.transparency = level;
    for (const markup of [
      '<div class="dropdown-menu"><div data-popover>Menu</div></div>',
      '<dialog class="command-dialog" open><div class="command"><header><input placeholder="Command" /></header><div role="menu">Commands</div></div></dialog>',
      '<dialog class="dialog" open><section><header>Dialog</header><div class="card">Card</div></section></dialog>',
      '<div class="toast-content">Toast</div>',
      '<div class="card" id="hovercard">Hover</div>',
      '<div class="card" id="commitcard">Commit</div>',
      '<section data-note-panel>Note</section>',
      '<header id="review-sub-bar">Review header</header>',
      '<section id="pr-footer" class="border-t"><div id="pr-bar">PR actions</div><div id="pr-comments-panel">Comments</div></section>',
      '<main id="main"><footer id="status" class="border-t">Status</footer></main>',
      '<section id="git-panel" class="border-t"><div class="git-panel-head border-b">Branch</div><div id="git-panel-body"><div class="input-group"><textarea placeholder="Message (optional)"></textarea></div><div id="git-recent-commits">Recent Commits</div></div></section>',
    ]) {
      const root = mount(markup);
      const sheet = root.querySelector('[data-popover], .command, section, #status') || root;
      const reduced = matchMedia('(prefers-reduced-transparency: reduce)').matches;
      test(
        `${level} ${sheet.id || sheet.className} blur`,
        style(sheet).backdropFilter,
        `blur(${reduced ? 0 : blur}px) saturate(1.4)`,
      );
      const background = style(sheet).backgroundColor;
      const actualAlpha = background.match(/\/\s*([\d.]+)\)/)?.[1];
      test(
        `${level} ${sheet.id || sheet.className} alpha`,
        Number(actualAlpha ?? 1),
        reduced ? 1 : alpha,
      );
      if (sheet.id === 'review-sub-bar')
        test(`${level} header preserves its border width`, style(sheet).borderTopWidth, '0px');
      if (sheet.id === 'pr-footer' || sheet.id === 'status') {
        test(`${level} footer preserves its divider`, style(sheet).borderTopWidth, '1px');
        test(`${level} footer adds no side border`, style(sheet).borderLeftWidth, '0px');
      }
      for (const child of sheet.querySelectorAll('#pr-bar, #pr-comments-panel')) {
        test(`${level} ${child.id} shares footer fill`, style(child).backgroundColor, 'rgba(0, 0, 0, 0)');
        test(`${level} ${child.id} adds no blur`, style(child).backdropFilter, 'none');
      }
      if (sheet.id === 'git-panel') {
        const group = sheet.querySelector('.input-group');
        test(`${level} Git composer shares panel fill`, style(group).backgroundColor, 'rgba(0, 0, 0, 0)');
        test(`${level} Git composer adds no blur`, style(group).backdropFilter, 'none');
        test(`${level} Git panel preserves divider`, style(sheet).borderTopWidth, '1px');
      }
      const header = sheet.querySelector('header');
      if (header) {
        test(`${level} nested header has no blur`, style(header).backdropFilter, 'none');
        test(
          `${level} nested header is transparent`,
          style(header).backgroundColor,
          'rgba(0, 0, 0, 0)',
        );
      }
    }
  }
  delete document.documentElement.dataset.transparency;
  const utility = mount('<button class="btn rounded-md" data-size="xs">Explicit utility</button>');
  test('utility layer overrides compact button radius', style(utility).borderRadius, '10px');
}
// Legacy user themes omit every new token. Exercise the app root fallbacks.
document.documentElement.dataset.theme = 'legacy-fixture';
document.documentElement.classList.remove('dark');
const legacy = mount('<button class="btn" data-variant="special">Explain</button>');
const legacyStyle = document.createElement('style');
legacyStyle.textContent =
  ':root[data-theme="legacy-fixture"] { --special: rgb(69,69,160); --nf: rgb(69,69,160); --background: white; --foreground: rgb(17,17,17); --accent: rgb(238,238,238); --border: rgb(170,170,170); --primary: rgb(221,221,221); --primary-text: rgb(51,51,51); --gi: rgb(31,99,120); --warn: rgb(102,85,0); --sel: rgb(170,187,221); --shadow: 0 2px 4px rgb(0 0 0 / 0.2); }';
document.head.append(legacyStyle);
check(
  'legacy special fill resolves',
  style(legacy).backgroundColor,
  token('background-color', '--accent'),
);
check('legacy ink fallback', style(legacy).color, 'rgb(17, 17, 17)');
check('legacy on-spiral fallback', token('color', '--on-spiral'), 'rgb(255, 255, 255)');
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
