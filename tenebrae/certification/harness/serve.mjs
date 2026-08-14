// In-process static server for certification probes.
// Each probe starts its own server on an ephemeral port — no background task
// to die on container restarts, no port collisions between parallel probes.
//
//   import { startServer } from '../serve.mjs';
//   const srv = await startServer();          // { url, close }
//   await page.goto(srv.url + 'step1.html');
//   ...
//   await srv.close();
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';

const ROOT = '/home/user/MonoFX/tenebrae';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export function startServer(){
  const server = http.createServer(async (req, res) => {
    try {
      const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
      const file = join(ROOT, path === '/' ? 'step1.html' : path);
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      const body = await readFile(file);
      const ext = file.slice(file.lastIndexOf('.'));
      res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise(r => server.close(r)),
      });
    });
  });
}
