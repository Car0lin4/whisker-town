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

## Put it on the internet (so anyone can play)

The game is a small Node.js server, so it needs a host that runs Node and supports WebSockets.
Some easy options are [Render](https://render.com), [Railway](https://railway.app), and [Fly.io](https://fly.io).

On Render:
1. Push this folder to a GitHub repository.
2. In Render, create a **New → Web Service** from that repository.
3. Build command: `npm install`. Start command: `npm start`.
4. Cats are saved in `data/world.json`. To keep them between deploys, add a **persistent disk**
   and set the environment variable `DATA_DIR` to the disk's mount path (for example `/var/data`).
   Without a disk, the town resets each time the server redeploys.

## How it works

| File | What it does |
|---|---|
| `server.js` | Web server + WebSocket game server. Holds the shared world, saves it every 5 s, makes idle cats wander and befriend each other. |
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
in `server.js`.
