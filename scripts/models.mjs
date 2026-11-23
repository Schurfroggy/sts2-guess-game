import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const slug = (name) => name.replace(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g, '_').toUpperCase();
const numeric = /^[-+]?\d+(?:\.\d+)?[mMfFdD]?$/;
const number = (value) => numeric.test(value ?? '') ? Number(value.replace(/[mMfFdD]$/, '')) : undefined;
const references = (text, kind) => [...text.matchAll(new RegExp(`\\b${kind}<(\\w+)>\\(\\)`, 'g'))].map((match) => match[1]);
const capture = (text, pattern) => text.match(pattern)?.[1];
const keywordsIn = (text) => [...text.matchAll(/CardKeyword\.(\w+)/g)].map((match) => match[1]);

function argumentsOf(source, start) {
  let depth = 0;
  let quoted = false;
  let segment = start;
  const args = [];
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (char === '"' && source[index - 1] !== '\\') quoted = !quoted;
    if (quoted) continue;
    if ('([{'.includes(char)) depth++;
    if (char === ')' && depth === 0) return [...args, source.slice(segment, index).trim()];
    if (')]}'.includes(char)) depth--;
    if (char === ',' && depth === 0) {
      args.push(source.slice(segment, index).trim());
      segment = index + 1;
    }
  }
  return args;
}

function getVariables(text, defaults) {
  const source = capture(text, /CanonicalVars\s*=>\s*([\s\S]*?);/) ?? '';
  const vars = {};
  for (const match of source.matchAll(/\bnew (\w*Var)(?:<(\w+)>)?\(/g)) {
    const [, kind, generic] = match;
    const args = argumentsOf(source, match.index + match[0].length);
    const named = args[0]?.startsWith('"');
    const key = named ? JSON.parse(args[0]) : generic ?? defaults[kind];
    const raw = args[named ? 1 : 0];
    const value = number(raw) ?? (raw === 'true' || raw === 'false' ? raw === 'true' : undefined)
      ?? (raw?.startsWith('"') ? JSON.parse(raw) : undefined);
    if (key && value !== undefined) vars[key] = value;
  }
  return vars;
}

export function readModels(root, strings) {
  const read = (name) => readFileSync(join(root, 'src/Core', name), 'utf8');
  const database = read('Models/ModelDb.cs');
  const model = read('Models/CardModel.cs');
  const list = (name, kind) => references(database.split(` ${name} =>`)[1].split('});')[0], kind);
  const characterModels = list('AllCharacters', 'Character').map((name) => read(`Models/Characters/${name}.cs`));
  const poolNames = characterModels.flatMap((character) => references(character, 'CardPool')).concat(list('AllSharedCardPools', 'CardPool'));
  const registered = new Map();
  const pools = {};
  const methodChars = /StartingDeck\s*=>\s*([\s\S]*?);/;
  for (const poolName of new Set(poolNames)) {
    const source = read(`Models/CardPools/${poolName}.cs`);
    const id = poolName.replace(/CardPool$/, '').toLowerCase();
    const title = capture(source, /Title => "([^"]+)"/);
    const row = {
      id, title,
      energy: capture(source, /EnergyColorName => "([^"]+)"/),
      color: capture(source, /CardFrameMaterialPath => "card_frame_([^"]+)"/),
      energyOutline: capture(source, /EnergyOutlineColor => new Color\("([^"]+)"\)/) ?? '46464a'
    };
    pools[id] = row;
    const cards = references(source.split('GenerateAllCards()')[1], 'Card');
    for (const card of cards) if (!registered.has(card)) registered.set(card, row);
  }
  for (const source of characterModels) {
    const pool = pools[references(source, 'CardPool')[0]?.replace(/CardPool$/, '').toLowerCase()];
    for (const card of references(capture(source, methodChars) ?? '', 'Card')) {
      if (!registered.has(card)) registered.set(card, pool);
    }
  }
  const defaults = {};
  for (const file of readdirSync(join(root, 'src/Core/Localization/DynamicVars'))) {
    const value = capture(read(`Localization/DynamicVars/${file}`), /const string defaultName = "([^"]+)"/);
    if (value) defaults[file.replace('.cs', '')] = value;
  }
  const ids = new Map();
  for (const key of Object.keys(strings.eng)) {
    const match = key.match(/^([A-Z0-9_]+)\.title(?:\.|$)/);
    if (!match) continue;
    const id = match[1];
    const normalized = id.replaceAll('_', '');
    if (ids.has(normalized) && ids.get(normalized) !== id) throw Error(`Conflicting IDs: ${id}`);
    ids.set(normalized, id);
  }

  const cards = [...registered].map(([className, pool]) => {
    const sourcePath = `src/Core/Models/Cards/${className}.cs`;
    const source = readFileSync(join(root, sourcePath), 'utf8');
    const id = ids.get(className.toUpperCase()) ?? slug(className);
    const ctor = source.match(/: base\(\s*(-?\d+)\s*,\s*CardType\.(\w+)\s*,\s*CardRarity\.(\w+)\s*,\s*TargetType\.(\w+)([^)]*)\)/);
    if (!ctor) throw Error(`Cannot read constructor: ${className}`);
    const [, energyValue, type, rarity, targetType, ctorOptions] = ctor;
    const visualPool = pools[capture(source, /VisualCardPool => ModelDb.CardPool<(\w+)CardPool>/)?.toLowerCase()] ?? pool;
    const starValue = Number(capture(source, /CanonicalStarCost => (-?\d+)/) ?? -1);
    const energy = /HasEnergyCostX => true/.test(source) ? 'X' : Number(energyValue) < 0 ? null : Number(energyValue);
    const stars = /HasStarCostX => true/.test(source) ? 'X' : starValue < 0 ? null : starValue;
    const keywords = [...new Set(keywordsIn(capture(source, /CanonicalKeywords\s*=>\s*([\s\S]*?);/) ?? ''))];
    const maxUpgrade = Number(capture(source, /MaxUpgradeLevel => (\d+)/) ?? capture(model, /MaxUpgradeLevel => (\d+)/));
    const upgradeCode = capture(source, /protected override void OnUpgrade\(\)\s*\{([\s\S]*?)^\t\}/m)?.trim() ?? '';
    const variables = getVariables(source, defaults);
    const initialValues = {
      BEAT_INTO_SHAPE: { CalculatedForge: variables.CalculationBase },
      GENETIC_ALGORITHM: { Block: Number(capture(source, /CurrentBlock = (\d+) \+ IncreasedBlock/)) },
      SHOW_OFF: { AimPower: variables.BaseAim },
      THE_SCYTHE: { Damage: Number(capture(source, /CurrentDamage = (\d+) \+ IncreasedDamage/)) }
    };
    for (const [key, value] of Object.entries(initialValues[id] ?? {})) {
      if (Number.isFinite(value)) variables[key] = value;
    }
    const upgradedVars = { ...variables };
    const upgrades = [...upgradeCode.matchAll(/DynamicVars(?:\.(\w+)|\["([^"]+)"\])\.UpgradeValueBy\(([^)]+)\)/g)];
    const unsupported = [];
    for (const [, property, direct, expression] of upgrades) {
      const key = direct ?? [property, property + 'Power'].find((candidate) => Object.hasOwn(variables, candidate));
      const delta = id === 'DINGY_DAGGER' && expression === '3 + CurrentUpgradeLevel' ? 3 : number(expression);
      if (key && typeof variables[key] === 'number' && delta !== undefined) upgradedVars[key] += delta;
      else unsupported.push(`${direct ?? property}: ${expression}`);
    }
    if (id === 'BEAT_INTO_SHAPE') upgradedVars.CalculatedForge = upgradedVars.CalculationBase;
    const upgradeEnergy = number(capture(upgradeCode, /EnergyCost\.UpgradeBy\(([^)]+)\)/)) ?? 0;
    const upgradeStars = number(capture(upgradeCode, /UpgradeStarCostBy\(([^)]+)\)/)) ?? 0;
    const upgradedKeywords = [...new Set([...keywords, ...keywordsIn([...upgradeCode.matchAll(/AddKeyword\(([^)]+)\)/g)].map((match) => match[1]).join(' '))])]
      .filter((keyword) => !upgradeCode.includes(`RemoveKeyword(CardKeyword.${keyword})`));
    const names = {};
    const descriptions = {};
    for (const [language, table] of Object.entries(strings)) {
      names[language] = table[id + '.title'] ?? table[id + '.title.dingy'];
      descriptions[language] = table[id + '.description'] ?? '';
    }
    if (!names.zhs || !names.eng) throw Error(`Missing localized name: ${className} (${id})`);
    return {
      id, className, sourcePath, names,
      alternateNames: Object.fromEntries(Object.entries(strings.zhs).filter(([key]) => key.startsWith(id + '.title.'))),
      descriptionTemplates: descriptions, pool: pool.id, resourcePool: pool.title,
      visualPool: visualPool.id, color: visualPool.color,
      energyIcon: visualPool.energy, energyOutline: pool.energyOutline,
      type, types: id === 'MAD_SCIENCE' ? ['Attack', 'Skill', 'Power'] : [type],
      rarity, target: capture(source, /override TargetType TargetType => TargetType\.(\w+)/) ?? targetType,
      energy, stars, keywords, variables, inLibrary: !/shouldShowInCardLibrary:\s*false|,\s*false/.test(ctorOptions),
      maxUpgrade, upgrade: maxUpgrade > 0 && {
        energy: typeof energy === 'number' ? energy + upgradeEnergy : energy,
        stars: typeof stars === 'number' ? stars + upgradeStars : stars,
        variables: upgradedVars, keywords: upgradedKeywords, code: upgradeCode, unresolved: unsupported
      },
      rank: null
    };
  });
  return { cards, pools };
}
