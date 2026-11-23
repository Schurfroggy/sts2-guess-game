const before = ['Ethereal', 'Sly', 'Retain', 'Innate', 'Unplayable'];
const after = ['Exhaust', 'Eternal'];
const enabled = (value) => value === true || (typeof value === 'number' && value !== 0);

function splitOutside(text, separator) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '{' || char === '(') depth++;
    if (char === '}' || char === ')') depth--;
    if (char === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  return [...parts, text.slice(start)];
}

export function resolveDescription(template, values, upgraded = false) {
  const unresolved = new Set();
  function expand(text, implicit) {
    let formatted = '';
    for (let index = 0; index < text.length; index++) {
      if (text[index] !== '{') {
        formatted += text[index];
        continue;
      }
      let depth = 1;
      let end = index + 1;
      for (; end < text.length && depth > 0; end++) {
        if (text[end] === '{') depth++;
        if (text[end] === '}') depth--;
      }
      if (depth) return formatted + text.slice(index);
      const [name, formatter = '', ...args] = splitOutside(text.slice(index + 1, end - 1), ':');
      const value = name === '' ? implicit : values[name];
      const icon = formatter.match(/^(energy|star)Icons\((\d*)\)$/);
      index = end - 1;
      if (formatter === 'show' && name === 'IfUpgraded') {
        const options = splitOutside(args.join(':'), '|');
        formatted += expand(options[upgraded ? 0 : 1] ?? '', value);
      } else if (formatter.startsWith('choose(') && value !== undefined) {
        const choices = formatter.slice(7, -1).split('|');
        const options = splitOutside(args.join(':'), '|');
        const chosen = choices.indexOf(String(value));
        formatted += expand(options[chosen < 0 ? choices.length : chosen] ?? '', value);
      } else if (typeof value === 'boolean') {
        const options = splitOutside(formatter === 'cond' ? args.join(':') : [formatter, ...args].join(':'), '|');
        formatted += expand(options[enabled(value) ? 0 : 1] ?? '', value);
      } else if (icon) {
        const [, resource, count] = icon;
        const amount = typeof value === 'string' && count ? Number(count) : value;
        if (typeof amount === 'number' && Number.isFinite(amount)) {
          formatted += name === 'energyPrefix' && amount === 1 ? '[energy]' : `[${resource}:${Math.trunc(amount)}]`;
        } else {
          unresolved.add(name);
          formatted += '〔动态〕';
        }
      } else if (value !== undefined && ['', 'diff()', 'inverseDiff()', 'abs()'].includes(formatter)) {
        formatted += formatter === 'abs()' ? Math.abs(value) : String(value);
      } else if (typeof value === 'number' && (formatter === 'percentMore()' || formatter === 'percentLess()')) {
        formatted += String(Math.round((formatter === 'percentMore()' ? value - 1 : 1 - value) * 100));
      } else {
        unresolved.add(name);
        formatted += '〔动态〕';
      }
    }
    return formatted;
  }
  return { text: expand(template), unresolved: [...unresolved] };
}

export function previewText(card, keywordStrings, upgraded = false, type = card.type) {
  const state = upgraded && card.upgrade ? card.upgrade : card;
  const vars = { ...state.variables };
  if (vars.CalculationBase !== undefined) {
    for (const key of ['CalculatedDamage', 'CalculatedBlock']) {
      if (card.descriptionTemplates.zhs.includes(`{${key}:`) && vars[key] === undefined) vars[key] = vars.CalculationBase;
    }
  }
  const keyword = (id) => `[gold]${keywordStrings[id.toUpperCase() + '.title'] ?? id}[/gold]${keywordStrings.PERIOD ?? '。'}`;
  const values = {
    ...vars, IfUpgraded: upgraded, InCombat: false, OnTable: false, IsTargeting: false, IsOstyAlive: false,
    GainsBlock: Boolean(vars.Block || vars.CalculatedBlock), HasRider: false, CardType: type,
    TargetType: card.id === 'MAD_SCIENCE' && type !== 'Attack' ? 'Self' : card.target,
    Violence: false, energyPrefix: card.energyIcon, singleStarIcon: '[star]'
  };
  const body = resolveDescription(card.descriptionTemplates.zhs, values, upgraded);
  return {
    text: [
      ...before.filter((item) => state.keywords.includes(item)).map(keyword),
      body.text,
      ...after.filter((item) => state.keywords.includes(item)).map(keyword)
    ].filter(Boolean).join('\n'),
    unresolved: body.unresolved
  };
}
