const markupTags = /(\[\/?(?:gold|blue|red|green|purple)\]|\[(?:energy|star)(?::-?\d+)?\])/gi;
const colors = /^\[(gold|blue|red|green|purple)\]$/i;
const resourceToken = /^\[(energy|star)(?::(-?\d+))?\]$/i;
const resourceNames = { energy: '能量', star: '辉星' };

export function descriptionParts(value) {
  let color = '';
  return value.split(markupTags).flatMap((part) => {
    if (!part) return [];
    if (/^\[\/(gold|blue|red|green|purple)\]$/i.test(part)) {
      color = '';
      return [];
    }
    const openColor = part.match(colors);
    if (openColor) {
      color = openColor[1].toLowerCase();
      return [];
    }
    const resource = part.match(resourceToken);
    if (!resource) return [{ text: part, color }];
    const kind = resource[1].toLowerCase();
    if (resource[2] === undefined) return { kind, label: resourceNames[kind], color, icons: 1, numeral: '' };
    const amount = Number(resource[2]);
    const label = `${amount}${resourceNames[kind]}`;
    const grouped = amount > 0 && amount < 4;
    return [{ kind, amount, label, color, icons: grouped ? amount : 1, numeral: grouped ? '' : String(amount) }];
  });
}

export function plainDescription(value) {
  return descriptionParts(value).map((part) => part.label ?? part.text).join('');
}
