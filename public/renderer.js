import { descriptionParts } from './description-markup.js';

const baseUrl = new URL('./', import.meta.url);
const canvas = { width: 360, height: 480, x: 184, y: 243 };
const ordinary = new Set(['attack', 'power', 'skill']);

function at(element, bounds) {
  const [left, top, width, height] = bounds;
  element.style.left = `${(left + canvas.x) / canvas.width * 100}%`;
  element.style.top = `${(top + canvas.y) / canvas.height * 100}%`;
  element.style.width = `${width / canvas.width * 100}%`;
  element.style.height = `${height / canvas.height * 100}%`;
  return element;
}

function appendMarkup(node, value, icons, lazyImages = false) {
  for (const part of descriptionParts(value)) {
    if (part.kind && icons?.[part.kind]) {
      const group = document.createElement('span');
      group.className = `inline-resource${part.color ? ` markup-${part.color}` : ''}`;
      group.setAttribute('role', 'img');
      group.setAttribute('aria-label', part.label);
      group.textContent = part.numeral;
      for (let index = 0; index < part.icons; index++) {
        const icon = document.createElement('img');
        if (lazyImages) icon.loading = 'lazy';
        icon.src = new URL(icons[part.kind], baseUrl);
        icon.alt = '';
        icon.decoding = 'async';
        group.append(icon);
      }
      node.append(group);
    } else if (part.color) {
      const emphasis = document.createElement('span');
      emphasis.className = `markup-${part.color}`;
      emphasis.textContent = part.label ?? part.text;
      node.append(emphasis);
    } else {
      node.append(document.createTextNode(part.label ?? part.text));
    }
  }
}

export function appendDescription(node, value, card, database, { lazyImages = false } = {}) {
  const resources = database.visuals.inlineResources;
  const prefix = database.pools[card.pool]?.energy ?? 'colorless';
  appendMarkup(node, value, {
    energy: resources?.energy[prefix] ?? resources?.energy.colorless,
    star: resources?.star
  }, lazyImages);
}

function picture(face, url, bounds, style = '', lazyImages = false) {
  const layer = document.createElement('img');
  layer.className = `face-layer ${style}`;
  if (lazyImages) layer.loading = 'lazy';
  layer.src = new URL(url, baseUrl);
  layer.alt = '';
  layer.decoding = 'async';
  face.append(at(layer, bounds));
  return layer;
}

function words(face, value, bounds, style, describe = appendMarkup) {
  const layer = document.createElement('div');
  layer.className = `face-layer face-text ${style}`;
  const span = document.createElement('span');
  describe(span, value);
  layer.append(span);
  face.append(at(layer, bounds));
  return layer;
}

export function getPreview(card, options = {}) {
  const type = options.type ?? card.type;
  const upgraded = Boolean(options.upgraded && card.upgrade);
  const variant = card.preview.variants?.[type];
  const text = (upgraded ? variant?.upgraded ?? card.preview.upgraded : variant?.base ?? card.preview.base);
  return {
    type, upgraded,
    title: card.names.zhs + (upgraded ? (card.maxUpgrade > 1 ? '+1' : '+') : ''),
    portrait: variant?.art ?? card.art.portrait,
    text: text.text,
    unresolved: [...new Set([...text.unresolved, ...(upgraded ? card.upgrade.unresolved : [])])],
    energy: upgraded ? card.upgrade.energy : card.energy,
    stars: upgraded ? card.upgrade.stars : card.stars
  };
}

export function renderCard(card, database, options = {}) {
  const view = getPreview(card, options);
  const { visuals, labels } = database;
  const type = view.type.toLowerCase();
  const inner = ordinary.has(type) ? type : 'skill';
  const outer = type === 'quest' ? 'quest' : inner;
  const ancient = card.rarity === 'Ancient';
  const layout = visuals.layout;
  const face = document.createElement('div');
  const addPicture = (url, bounds, style) => picture(face, url, bounds, style, options.lazyImages);
  face.className = `face${view.upgraded ? ' face-upgraded' : ''}${ancient ? ' face-ancient' : ''}`;
  face.setAttribute('role', 'img');
  face.setAttribute('aria-label', `${view.title}，${labels.types[view.type]}，${view.energy === null ? '无能量费用' : view.energy + '费'}`);
  if (ancient) {
    addPicture(view.portrait, layout.AncientPortrait, 'ancient-portrait');
    addPicture(visuals.ancient.border, layout.AncientBorder, 'ancient-border');
    addPicture(visuals.ancient[inner], layout.AncientTextBg, 'ancient-text');
    addPicture(visuals.ancient.banner, layout.AncientBanner, 'banner');
  } else {
    addPicture(view.portrait, layout.Portrait);
    addPicture(visuals.frames[card.color][outer], layout.Frame, 'frame');
    addPicture(visuals.borders[card.rarity][inner], layout.PortraitBorder);
    addPicture(visuals.banners[card.rarity], layout.TitleBanner, 'banner');
  }
  const title = words(face, view.title, layout.TitleLabel, 'face-title');
  title.style.setProperty('--title-size', `${Math.min(7.0, 53 / Array.from(view.title).length)}cqw`);
  addPicture(visuals.plaques[card.rarity], layout.TypePlaque);
  words(face, labels.types[view.type], layout.TypePlaque, 'face-type');
  const text = words(face, view.text, layout.DescriptionLabel, 'face-description', (node, value) => appendDescription(node, value, card, database, options));
  const textLength = descriptionParts(view.text).reduce((length, part) => length + (part.kind ? part.icons + part.numeral.length : part.text.length), 0);
  text.style.setProperty('--description-size', `${textLength > 108 ? 3.4 : textLength > 70 ? 4.1 : textLength > 45 ? 4.8 : 5.55}cqw`);
  if (view.energy !== null) {
    addPicture(visuals.energy[card.energyIcon], layout.EnergyIcon);
    const numeral = words(face, String(view.energy), layout.EnergyIcon, 'face-energy');
    numeral.style.setProperty('--cost-outline', `#${card.energyOutline}`);
  }
  if (view.stars !== null) {
    addPicture(visuals.star, layout.StarIcon);
    words(face, String(view.stars), layout.StarIcon, 'face-stars');
  }
  return face;
}
