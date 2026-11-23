import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const priorWeight = 50;
const catalog = JSON.parse(await readFile(new URL('../public/data/cards.json', import.meta.url), 'utf8'));
const version = catalog.game.version;
const destination = process.argv[2] ?? fileURLToPath(new URL('../public/data/community-scores.json', import.meta.url));
const counts = new Map(catalog.cards.map(({ id }) => [id, { picked: 0, offered: 0 }]));
const characterIds = new Set(['IRONCLAD', 'SILENT', 'REGENT', 'NECROBINDER', 'DEFECT', 'FOOL']);
const exportUrl = `https://spire-codex.com/exports/runs-${version}.jsonl.gz`;
const uncompressed = createGunzip();
const decompressed = pipeline(process.stdin, uncompressed);
decompressed.catch(() => {});
const lines = createInterface({ input: uncompressed, crlfDelay: Infinity });
let exportedRuns = 0;
let sampleRuns = 0;
for await (const line of lines) {
  if (!line.trim()) continue;
  const run = JSON.parse(line);
  if (run.build_id !== version) throw Error(`Expected ${version} but found ${run.build_id}`);
  exportedRuns++;
  if (run.game_mode !== 'standard' || run.is_custom_game || run.players?.length !== 1 || run.modifiers?.length) continue;
  const character = run.players[0].character;
  if (!characterIds.has(character?.replace(/^CHARACTER\./, ''))) continue;
  const points = run.map_point_history?.flat();
  if (!points?.length || (run.was_abandoned && points.length <= 5)) continue;
  sampleRuns++;
  for (const point of points) {
    if (point.map_point_type === 'shop' || point.rooms?.some(({ room_type }) => room_type === 'shop')) continue;
    const choices = point.player_stats?.[0]?.card_choices ?? [];
    for (const choice of choices) {
      const id = choice.card?.id;
      if (typeof id !== 'string' || typeof choice.was_picked !== 'boolean') continue;
      const count = counts.get(id.replace(/^CARD\./, ''));
      if (!count) continue;
      count.offered++;
      if (choice.was_picked) count.picked++;
    }
  }
}
await decompressed;

const measured = [...counts.entries()].filter(([, count]) => count.offered > 0);
if (!sampleRuns || !measured.length) throw Error('No matching scored games; previous snapshot unchanged.');
const totalPicked = measured.reduce((sum, [, count]) => sum + count.picked, 0);
const totalOffered = measured.reduce((sum, [, count]) => sum + count.offered, 0);
const baseline = totalPicked / totalOffered;
const adjusted = (count) => (count.picked + priorWeight * baseline) / (count.offered + priorWeight);
const rates = measured.map(([, count]) => adjusted(count));
const min = Math.min(...rates);
const max = Math.max(...rates);
const cards = Object.fromEntries([...counts].map(([id, count]) => [
  id,
  {
    ...count,
    score: count.offered === 0 ? 0 : min === max ? 100 : Math.round(1 + 99 * (adjusted(count) - min) / (max - min))
  }
]));
const snapshot = {
  version, source: 'Spire Codex', exportUrl, importedAt: new Date().toISOString(),
  cohort: 'standard_solo_no_modifiers', exportedRuns, sampleRuns, totalPicked, totalOffered,
  method: { priorWeight, baseline, adjustedMin: min, adjustedMax: max, scale: 'linear_1_100_zero_if_unoffered' }, cards
};
const temporary = `${destination}.${randomUUID()}.tmp`;
try {
  await writeFile(temporary, JSON.stringify(snapshot) + '\n', { flag: 'wx' });
  await rename(temporary, destination);
} finally {
  await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
}
console.log(`Imported ${version}: ${sampleRuns}/${exportedRuns} runs, ${measured.length}/${counts.size} cards, ${totalOffered} offers.`);
