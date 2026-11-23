import { createServer } from 'node:http';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roomApi, sessionFromRequest } from './room-api.mjs';
import { Rooms } from './rooms.mjs';
import { CardScores } from './card-scores.mjs';

const root = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const catalogData = resolve(root, 'data/cards.json');
const communityScores = resolve(root, 'data/community-scores.json');
const catalogPage = resolve(root, 'index.html');
const routes = { '/': '/home.html', '/room': '/room.html', '/catalog': '/index.html' };
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.otf': 'font/otf', '.svg': 'image/svg+xml'
};

export async function startServer({
  host = process.env.HOST ?? '127.0.0.1',
  port = Number(process.env.PORT ?? 4173),
  stateDir = resolve(process.env.STS2CIKU_STATE_DIR ?? process.env.STATE_DIRECTORY ?? resolve(root, '../.state')),
  createRooms = (database, scores) => new Rooms(database, { scores }),
  handleExtra
} = {}) {
  const database = JSON.parse(await readFile(catalogData, 'utf8'));
  const scoreAliases = JSON.parse(await readFile(new URL('./card-score-aliases.json', import.meta.url), 'utf8'));
  const community = await readFile(communityScores, 'utf8').then(JSON.parse).catch((error) => {
    if (error.code !== 'ENOENT') console.warn('Community scores unavailable:', error.message);
    return null;
  });
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const scores = new CardScores(resolve(stateDir, 'card-scores.sqlite'), database.cards, scoreAliases);
  const rooms = createRooms(database, scores);
  const handleRoom = roomApi(database, rooms, community);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (handleExtra && await handleExtra(req, res, url, rooms)) return;
      if (url.pathname.startsWith('/api/')) return handleRoom(req, res, url);
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
      }
      const pathname = decodeURIComponent(url.pathname);
      const file = resolve(root, '.' + (routes[pathname] ?? pathname));
      const extension = extname(file);
      if (!file.startsWith(root + sep) || !types[extension]) {
        res.writeHead(404).end();
        return;
      }
      const isCatalog = file === catalogPage || file === catalogData || file === communityScores;
      if (isCatalog && !rooms.canViewCatalog(sessionFromRequest(req))) {
        if (file === catalogPage) res.writeHead(302, { Location: '/room', 'Cache-Control': 'no-store' }).end();
        else res.writeHead(403, { 'Cache-Control': 'no-store' }).end();
        return;
      }
      const info = await stat(file);
      if (!info.isFile()) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': types[extension],
        'Content-Length': info.size,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': isCatalog ? 'no-store' : ['.png', '.webp', '.otf', '.svg'].includes(extension) ? 'public, max-age=86400' : 'no-cache'
      });
      if (req.method === 'HEAD') res.end();
      else createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch {
      res.writeHead(404).end();
    }
  });
  server.once('close', () => scores.close());
  server.listen(port, host);
  await once(server, 'listening');
  console.log(`Local: http://${host}:${server.address().port}/`);
  return server;
}
