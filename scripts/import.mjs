import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readModels } from './models.mjs';
import { previewText } from './descriptions.mjs';
import { openPack } from './pack.mjs';
import { subsetCardFont } from './subset-card-font.mjs';
import { plainDescription } from '../public/description-markup.js';

const [sourcePath = '../SlayTheSpire2', packPath = join(homedir(), 'Library/Application Support/Steam/steamapps/common/Slay the Spire 2/SlayTheSpire2.app/Contents/Resources/Slay the Spire 2.pck'),
  godot = '/Applications/Godot_mono.app/Contents/MacOS/Godot'] = process.argv.slice(2);
const root = fileURLToPath(new URL('..', import.meta.url));
const source = resolve(sourcePath);
const packFile = resolve(packPath);
const version = JSON.parse(readFileSync(join(source, 'release_info.json'), 'utf8'));
const installed = JSON.parse(readFileSync(join(dirname(packFile), 'release_info.json'), 'utf8'));
if (version.commit !== installed.commit || version.version !== installed.version) throw Error('Source and asset pack versions differ');
const pack = openPack(packFile);
const tmp = mkdtempSync(join(tmpdir(), 'sts2-catalog-'));
const output = join(root, 'public/assets');
const data = join(root, 'public/data');
const jobs = {};
const assetsBySource = new Map();
const restored = new Set();
const packPaths = new Set(pack.names);
const sprites = 'images/atlases/ui_atlas.sprites/card';
const tables = (language, file) => JSON.parse(pack.text(`localization/${language}/${file}.json`));

function write(at, bytes) {
  mkdirSync(dirname(at), { recursive: true });
  writeFileSync(at, bytes);
}

function restore(name) {
  if (restored.has(name)) return;
  restored.add(name);
  if (!packPaths.has(name)) {
    restore(name + '.import');
    return;
  }
  if (!/\.(?:tres|import)$/.test(name)) {
    write(join(tmp, name), pack.read(name));
    return;
  }
  const source = pack.text(name).replace(/ uid="uid:\/\/[^"]+"/g, '');
  write(join(tmp, name), source);
  for (const match of source.matchAll(/path(?:\.\w+)?\s*=\s*"res:\/\/([^"]+)"/g)) restore(match[1]);
}

function image(name, outputName, shader) {
  if (!pack.has(name)) throw Error(`Missing image: ${name}`);
  const cacheKey = `${name}:${shader ?? ''}`;
  if (assetsBySource.has(cacheKey)) return assetsBySource.get(cacheKey);
  let tint;
  if (shader) {
    const source = pack.text(shader);
    tint = ['h', 's', 'v'].map((param) => Number(source.match(new RegExp(`shader_parameter/${param} = ([^\\n]+)`))[1]));
  }
  restore(name);
  jobs[outputName] = { source: name, tint };
  const url = `assets/${outputName}.png`;
  assetsBySource.set(cacheKey, url);
  return url;
}

const poolNames = {
  ironclad: '铁甲战士', silent: '静默猎手', defect: '故障机器人', regent: '摄政王', necrobinder: '亡灵契约师', fool: '愚者',
  colorless: '无色', event: '事件', curse: '诅咒', quest: '任务', status: '状态', token: '衍生', deprecated: '已弃用'
};
const colorNames = { red: '红色', green: '绿色', blue: '蓝色', orange: '橙色', pink: '粉色', yellow: '黄色', colorless: '无色', curse: '诅咒色', quest: '任务色' };
const targetNames = {
  None: '无需目标', Self: '自身', AnyEnemy: '单个敌人', AllEnemies: '所有敌人', RandomEnemy: '随机敌人',
  AnyAlly: '单个队友', AllAllies: '所有队友', AnyPlayer: '任一玩家', TargetedNoCreature: '非生物目标', Osty: '奥斯提'
};
const fallbacks = { DINGY_DAGGER: ['dingy_dagger', 'fine_dagger', 'pristine_dagger'], WITHER: ['wither1', 'wither2', 'wither3'],
  MAD_SCIENCE: ['mad_science_attack', 'mad_science_skill', 'mad_science_power'] };

function exportDatabase(database) {
  const db = new DatabaseSync(join(root, 'cards.sqlite'));
  try {
    db.exec(`BEGIN;
      DROP TABLE IF EXISTS cards; DROP TABLE IF EXISTS metadata;
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE cards (id TEXT PRIMARY KEY, name_zh TEXT NOT NULL, name_en TEXT NOT NULL, type TEXT NOT NULL,
        pool TEXT NOT NULL, color TEXT NOT NULL, rarity TEXT NOT NULL, energy ANY, stars ANY,
        description TEXT NOT NULL, portrait TEXT NOT NULL, details TEXT NOT NULL CHECK (json_valid(details))) STRICT;
      CREATE INDEX cards_facets ON cards(type, color, pool, rarity);
    `);
    db.prepare('INSERT INTO metadata VALUES (?, ?)').run('game', JSON.stringify(database.game));
    const insert = db.prepare('INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const card of database.cards) {
      insert.run(card.id, card.names.zhs, card.names.eng, card.type, card.pool, card.color, card.rarity, card.energy, card.stars,
        plainDescription(card.preview.base.text), card.art.portrait, JSON.stringify(card));
    }
    db.exec('COMMIT');
  } finally {
    db.close();
  }
}

try {
  const strings = Object.fromEntries(['zhs', 'zht', 'eng'].map((language) => [language, tables(language, 'cards')]));
  const ui = tables('zhs', 'gameplay_ui');
  const characters = tables('zhs', 'characters');
  const keywordStrings = tables('zhs', 'card_keywords');
  const { cards, pools } = readModels(source, strings);
  const localize = (prefix, value) => ui[`${prefix}.${value.toUpperCase()}`] ?? value;
  const layouts = pack.text('scenes/cards/card.tscn');
  const visuals = { frames: {}, borders: {}, banners: {}, plaques: {}, energy: {}, inlineResources: { energy: {} }, ancient: {}, layout: {} };
  const font = 'fonts/zhs/NotoSansMonoCJKsc-Regular.otf';
  restore(font);
  for (const name of ['Portrait', 'Frame', 'DescriptionLabel', 'PortraitBorder', 'TitleBanner', 'TitleLabel', 'TypePlaque', 'EnergyIcon', 'StarIcon', 'AncientPortrait', 'AncientBorder', 'AncientTextBg', 'AncientBanner']) {
    const node = layouts.split(`[node name="${name}"`)[1].split('[node ')[0];
    const offsets = ['left', 'top', 'right', 'bottom'].map((edge) => Number(node.match(new RegExp(`offset_${edge} = ([^\\n]+)`))[1]));
    const scale = name === 'AncientPortrait' ? 0.5 : 1;
    visuals.layout[name] = [offsets[0], offsets[1], (offsets[2] - offsets[0]) * scale, (offsets[3] - offsets[1]) * scale];
  }
  const rarityMaterials = new Set(['uncommon', 'rare', 'curse', 'status', 'event', 'quest', 'ancient']);
  for (const color of new Set(Object.values(pools).map((pool) => pool.color))) {
    visuals.frames[color] = {};
    for (const type of ['attack', 'skill', 'power', 'quest']) {
      visuals.frames[color][type] = image(`${sprites}/card_frame_${type}_s.tres`, `ui/frame-${color}-${type}`,
        `materials/cards/frames/card_frame_${color}_mat.tres`);
    }
  }
  for (const rarity of new Set(cards.map((card) => card.rarity))) {
    const key = rarity.toLowerCase();
    const material = `materials/cards/banners/card_banner_${rarityMaterials.has(key) ? key : 'common'}_mat.tres`;
    visuals.banners[rarity] = image(`${sprites}/card_banner.tres`, `ui/banner-${key}`, material);
    visuals.plaques[rarity] = image('images/ui/cards/card_portrait_border_plaque2.png', `ui/plaque-${key}`, material);
    visuals.borders[rarity] = {};
    for (const type of ['attack', 'skill', 'power']) {
      visuals.borders[rarity][type] = image(`${sprites}/card_portrait_border_${type}_s.tres`, `ui/border-${key}-${type}`, material);
    }
  }
  for (const key of new Set(Object.values(pools).map((pool) => pool.energy))) {
    const atlas = `${sprites}/energy_${key}.tres`;
    visuals.energy[key] = image(pack.has(atlas) ? atlas : `images/packed/energy_icons/energy_${key}.png`, `ui/energy-${key}`);
    visuals.inlineResources.energy[key] = image(`images/packed/sprite_fonts/${key}_energy_icon.png`, `ui/inline-energy-${key}`);
  }
  visuals.inlineResources.star = image('images/packed/sprite_fonts/star_icon.png', 'ui/inline-star');
  visuals.star = image('images/ui/combat/energy_star.png', 'ui/star');
  visuals.ancient.banner = image(`${sprites}/ancient_banner.tres`, 'ui/ancient-banner');
  visuals.ancient.border = image('images/atlases/compressed_atlas.sprites/ancient_card_border.tres', 'ui/ancient-border');
  for (const type of ['attack', 'skill', 'power']) {
    visuals.ancient[type] = image(`images/atlases/compressed_atlas.sprites/ancient_text_bg_${type}.tres`, `ui/ancient-text-${type}`);
  }
  const missingArt = [];
  for (const card of cards) {
    const names = fallbacks[card.id] ?? [card.id.toLowerCase()];
    const prefix = `images/atlases/card_atlas.sprites/${card.resourcePool}/`;
    const variants = [];
    for (const name of names) {
      const normal = `${prefix}${name}.tres`;
      const beta = `${prefix}beta/${name}.tres`;
      const raw = `images/packed/card_portraits/${card.resourcePool}/`;
      if (pack.has(normal)) variants.push({ kind: name, path: image(normal, `art/${name}`) });
      else if (pack.has(raw + name + '.png')) variants.push({ kind: name, path: image(raw + name + '.png', `art/${name}`) });
      if (pack.has(beta)) variants.push({ kind: name + '-beta', path: image(beta, `art/${name}-beta`), beta: true });
      else if (!pack.has(normal) && pack.has(raw + 'beta/' + name + '.png')) {
        variants.push({ kind: name + '-beta', path: image(raw + 'beta/' + name + '.png', `art/${name}-beta`), beta: true });
      }
    }
    if (!variants.length) missingArt.push(card.id);
    const selected = variants.find((item) => !item.beta) ?? variants[0];
    card.art = { portrait: selected?.path ?? image('images/atlases/card_atlas.sprites/beta.tres', 'art/beta'), fallback: !selected, beta: Boolean(selected?.beta), variants };
    card.preview = { base: previewText(card, keywordStrings), upgraded: card.upgrade ? previewText(card, keywordStrings, true) : null };
    if (card.types.length > 1) {
      card.preview.variants = Object.fromEntries(card.types.map((type) => [type, {
        art: variants.find((item) => item.kind === `mad_science_${type.toLowerCase()}`)?.path ?? card.art.portrait,
        base: previewText(card, keywordStrings, false, type), upgraded: previewText(card, keywordStrings, true, type)
      }]));
    }
  }
  const order = new Intl.Collator('zh-CN');
  cards.sort((left, right) => order.compare(left.names.zhs, right.names.zhs) || left.id.localeCompare(right.id));
  const rarities = [...new Set(cards.map(({ rarity }) => rarity))];
  const firstRarities = ['Common', 'Uncommon', 'Rare'];
  const orderedRarities = [
    ...firstRarities.filter((rarity) => rarities.includes(rarity)),
    ...rarities.filter((rarity) => !firstRarities.includes(rarity))
  ];
  const labels = {
    pools: Object.fromEntries(Object.keys(pools).map((pool) => [pool, characters[`${pool.toUpperCase()}.title`] ?? poolNames[pool]])),
    colors: colorNames, targets: targetNames,
    types: Object.fromEntries([...new Set(cards.flatMap((card) => card.types))].map((type) => [type, localize('CARD_TYPE', type)])),
    rarities: Object.fromEntries(orderedRarities.map((rarity) => [rarity, localize('CARD_RARITY', rarity)])),
    keywords: Object.fromEntries([...new Set(cards.flatMap((card) => [...card.keywords, ...(card.upgrade?.keywords ?? [])]))]
      .map((word) => [word, keywordStrings[word.toUpperCase() + '.title'] ?? word]))
  };
  const database = {
    schema: 1, game: { version: version.version, commit: version.commit, branch: 'public-beta' },
    labels, visuals, pools, cards,
    importNotes: { missingArt }
  };
  mkdirSync(output, { recursive: true });
  write(join(tmp, 'project.godot'), 'config_version=5\n[application]\nconfig/name="STS2 Catalog Asset Export"\n');
  write(join(tmp, 'export.gd'), readFileSync(join(root, 'scripts/export.gd')));
  write(join(tmp, 'jobs.json'), JSON.stringify({ jobs, font, output }));
  const exported = spawnSync(godot, ['--audio-driver', 'Dummy', '--path', tmp, '--log-file', join(tmp, 'export.log'),
    '--script', 'res://export.gd'], { env: { ...process.env, HOME: tmp }, stdio: 'inherit', timeout: 180000 });
  if (exported.error) throw exported.error;
  if (exported.status !== 0 || !existsSync(join(output, 'card-font.otf'))) throw Error(`Godot asset export did not finish: ${exported.signal ?? exported.status}`);
  subsetCardFont(database, output);
  write(join(data, 'cards.json'), JSON.stringify(database));
  exportDatabase(database);
  console.log(`Imported ${cards.length} cards; ${Object.keys(jobs).length} image layers; ${missingArt.length} use the game's placeholder.`);
  if (missingArt.length) console.log('Placeholder art:', missingArt.join(', '));
} finally {
  pack.close();
  rmSync(tmp, { recursive: true, force: true });
}
