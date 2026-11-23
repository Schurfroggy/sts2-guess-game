import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const rankLimit = 100;

export class CardScores {
  constructor(file, cards, aliases = {}) {
    if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)
      || Object.values(aliases).some((key) => typeof key !== 'string' || !key.trim())) {
      throw Error('Invalid card score aliases');
    }
    const mappings = new Map(Object.entries(aliases));
    const resolveKey = (id) => {
      const seen = new Set();
      while (mappings.has(id)) {
        if (seen.has(id)) throw Error(`Cyclic card score alias: ${id}`);
        seen.add(id);
        id = mappings.get(id);
      }
      return id;
    };
    for (const id of mappings.keys()) resolveKey(id);
    this.keys = new Map(cards.map(({ id }) => [id, resolveKey(id)]));
    this.activeKeys = new Set(this.keys.values());
    if (this.activeKeys.size !== this.keys.size) throw Error('Active cards share a card score key');

    this.db = new DatabaseSync(file);
    try {
      this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
      const { user_version: version } = this.db.prepare('PRAGMA user_version').get();
      if (version > 1) throw Error(`Unsupported card score schema: ${version}`);
      if (version === 0) this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS kao_votes (
          card_key TEXT NOT NULL,
          voter_hash TEXT NOT NULL,
          PRIMARY KEY (card_key, voter_hash)
        ) STRICT, WITHOUT ROWID;
        PRAGMA user_version = 1;
        COMMIT;
      `);
      this.read = this.db.prepare(`
        SELECT count(*) AS kao, count(*) FILTER (WHERE voter_hash = ?) AS rated
        FROM kao_votes WHERE card_key = ?
      `);
      this.insert = this.db.prepare(`
        INSERT INTO kao_votes (card_key, voter_hash) VALUES (?, ?)
        ON CONFLICT (card_key, voter_hash) DO NOTHING
      `);
      this.remove = this.db.prepare('DELETE FROM kao_votes WHERE card_key = ? AND voter_hash = ?');
      this.readDataVersion = this.db.prepare('PRAGMA data_version');
      this.readRankedKeys = this.db.prepare('SELECT card_key FROM kao_votes GROUP BY card_key ORDER BY count(*) DESC, card_key ASC');
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  voter(session) {
    return session ? createHash('sha256').update(session).digest('hex') : null;
  }

  get(id, voter = null) {
    const key = this.keys.get(id);
    if (key === undefined) return null;
    const { kao, rated } = this.read.get(voter, key);
    return { kao, rated: Boolean(rated), rank: kao ? this.rankFor(key) : null };
  }

  rankFor(key) {
    const { data_version: version } = this.readDataVersion.get();
    if (!this.ranks || this.rankVersion !== version) {
      const ranks = new Map();
      for (const { card_key: rankedKey } of this.readRankedKeys.iterate()) {
        if (this.activeKeys.has(rankedKey)) ranks.set(rankedKey, ranks.size + 1);
        if (ranks.size === rankLimit) break;
      }
      this.ranks = ranks;
      this.rankVersion = version;
    }
    return this.ranks.get(key) ?? null;
  }

  rate(id, voter, rated = true) {
    const key = this.keys.get(id);
    if (key === undefined || !voter) throw Error('Missing card score key or voter');
    const { changes } = (rated ? this.insert : this.remove).run(key, voter);
    if (changes) this.ranks = null;
  }

  close() {
    this.db.close();
  }
}
