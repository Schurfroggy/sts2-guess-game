import { spawnSync } from 'node:child_process';
import { copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { plainDescription } from '../public/description-markup.js';
import { getPreview } from '../public/renderer.js';

export function subsetCardFont(database, assets) {
  const glyphs = new Set(' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-');
  const include = (value) => {
    for (const character of value) {
      if (character.codePointAt(0) >= 32) glyphs.add(character);
    }
  };
  for (const label of Object.values(database.labels.types)) include(label);
  for (const card of database.cards) {
    for (const type of card.types) {
      for (const upgraded of card.upgrade ? [false, true] : [false]) {
        const view = getPreview(card, { type, upgraded });
        include(view.title);
        include(plainDescription(view.text));
      }
    }
  }

  const original = join(assets, 'card-font.otf');
  const subset = join(assets, 'card-font-subset.otf');
  const text = [...glyphs].join('');
  const result = spawnSync('hb-subset', [`--text=${text}`, '--output-file=-', original], { maxBuffer: 32 * 1024 * 1024 });
  if (result.error?.code === 'ENOENT') {
    copyFileSync(original, subset);
    console.warn('hb-subset was not found. Using the full card font.');
    return;
  }
  if (result.error) throw result.error;
  if (result.status !== 0 || !result.stdout.length) throw Error(`Card font subsetting failed: ${result.stderr.toString().trim()}`);
  writeFileSync(subset, result.stdout);
}
