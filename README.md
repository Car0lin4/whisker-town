# 🐾 Whisker Town

A cozy multiplayer cat town for the web. Everyone who opens the site shares the same world:
adopt as many cats as you like, dress them up, walk them around, chat, and have them
boop, play, groom, cuddle, or pounce on anyone's cats (including each other).

## Run it on your computer

```bash
cd whisker-town
npm install      # only the first time
npm start
```

Then open **http://localhost:3000**.

People on the **same Wi-Fi** can join with the "Same Wi-Fi" address printed in the terminal
(for example `http://192.168.1.20:3000`).

## Online: https://whisker-town.vercel.app

The game is hosted on **Vercel** (project `whisker-town`). To publish changes:

```bash
vercel deploy --prod
```

- `vercel.json` runs `server.js` as a Node service (static files + the live `/api/ws` connection).
- Cats are saved in **Upstash Redis** (added from the Vercel Marketplace, which sets the
  `KV_REST_API_URL` / `KV_REST_API_TOKEN` env vars). Without those vars, cats are saved to
  `data/world.json` instead, which is what happens on your computer.
- To keep costs low, the town is written to the database at most once a minute, plus a few
  seconds after a cat is adopted, changed or removed. Cats walking around never trigger a save.

It also still runs on any Node host with WebSockets (Render, Railway, Fly.io): build `npm install`,
start `npm start`, and set `DATA_DIR` to a persistent disk path.

## How it works

| File | What it does |
|---|---|
| `server.js` | Serves the game files and the live connection. |
| `lib/world.js` | The shared world: cats, rooms, interactions; makes idle cats wander and befriend each other. |
| `lib/storage.js` | Saves the town (Upstash Redis online, `data/world.json` locally). |
| `public/shared.js` | Rooms, doors, colors, patterns, accessories (used by both server and browser). |
| `public/catdraw.js` | Draws every cat from its look (fur, pattern, eyes, accessory). |
| `public/game.js` | Rooms, movement, chat, interactions, cat creator. |

Players don't need accounts. Each browser gets a secret ID (kept in `localStorage`) that proves
which cats belong to it, so only you can control your cats. Opening the game in a different
browser or device counts as a different player.

### Adding things

- **New room:** add it to `ROOMS` and `ROOM_ORDER` in `shared.js`, add a door to it from another
  room, and write a `paintYourRoom(g)` function in `game.js`.
- **New accessory:** add its name to `ACCESSORIES` in `shared.js` and a `case` in
  `drawAccessory` in `catdraw.js`.
- **New interaction:** add it to `INTERACTIONS` in `shared.js`, give it a label in `ACT_LABELS`,
  and add a `case` in `onAct` in `game.js`.

Limits: 300 cats per player and 5,000 per town. Change `MAX_CATS_PER_PLAYER` / `MAX_CATS_TOTAL`
in `lib/world.js`.
