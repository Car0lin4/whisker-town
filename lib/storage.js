'use strict';
// Where the town is saved.
// - With Upstash Redis env vars (set up on Vercel): saved in the online database.
// - Otherwise: saved to data/world.json on this computer.
const fs = require('fs');
const path = require('path');

const KEY = 'whisker-town:world';
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

if (url && token) {
  const cmd = async (args) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error(`Redis HTTP ${r.status}`);
    return (await r.json()).result;
  };
  module.exports = {
    kind: 'redis',
    interval: 60000, // at most one write per minute (~$0.10/month on Upstash pay-as-you-go)
    async read() { const s = await cmd(['GET', KEY]); return s ? JSON.parse(s) : null; },
    async write(data) { await cmd(['SET', KEY, JSON.stringify(data)]); },
  };
} else {
  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const FILE = path.join(DATA_DIR, 'world.json');
  module.exports = {
    kind: 'file ' + FILE,
    interval: 5000,
    async read() {
      try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
      catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    },
    async write(data) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE + '.tmp', JSON.stringify(data));
      fs.renameSync(FILE + '.tmp', FILE);
    },
  };
}
