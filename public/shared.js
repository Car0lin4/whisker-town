// Settings shared by the server (Node) and the browser.
(function (root) {
  const SHARED = {
    W: 960,
    H: 600,
    FLOOR: { minX: 50, maxX: 910, minY: 345, maxY: 575 },
    SPEED: 170, // pixels per second

    ROOM_ORDER: ['plaza', 'cafe', 'garden', 'rooftop'],
    ROOMS: {
      plaza: {
        name: 'Town Square', emoji: '⛲',
        doors: [
          { to: 'garden', x: 75, y: 470 },
          { to: 'cafe', x: 885, y: 470 },
          { to: 'rooftop', x: 800, y: 365 },
        ],
      },
      cafe: { name: 'Sardine Café', emoji: '☕', doors: [{ to: 'plaza', x: 885, y: 470 }] },
      garden: { name: 'Catnip Garden', emoji: '🌷', doors: [{ to: 'plaza', x: 885, y: 470 }] },
      rooftop: { name: 'Moonlit Rooftop', emoji: '🌙', doors: [{ to: 'plaza', x: 90, y: 470 }] },
    },

    PATTERNS: ['solid', 'tabby', 'spots', 'tuxedo', 'calico', 'siamese'],
    ACCESSORIES: ['none', 'bow', 'tophat', 'crown', 'scarf', 'flower', 'glasses', 'beanie', 'bandana', 'collar'],

    SOLO_ACTIONS: ['meow', 'purr', 'dance', 'sleep', 'jump'],
    INTERACTIONS: ['boop', 'play', 'groom', 'cuddle', 'pounce'],

    FUR_COLORS: ['#f4a259', '#3b3b3b', '#f5f3ec', '#9e9e9e', '#c8a27a', '#6b4f3a', '#e8d5b7', '#7a8ca3', '#f2b8c6', '#b9a2e0'],
    PATTERN_COLORS: ['#8a4b1f', '#2b2b2b', '#f5f3ec', '#6e6e6e', '#d9822b', '#4a3426', '#5a6b85', '#c96f8f'],
    EYE_COLORS: ['#5cb85c', '#f0c419', '#4aa3df', '#e67e22', '#8e44ad', '#2fbfa0', '#d64545'],
    ACC_COLORS: ['#e63946', '#ff8fab', '#ffd23f', '#3a86ff', '#2a9d8f', '#8338ec', '#ffffff', '#222222'],

    // Where a cat appears when it walks into `room` coming from `from`.
    spawnFor(room, from) {
      const r = SHARED.ROOMS[room];
      const d = r && r.doors.find((d) => d.to === from);
      if (!d) return { x: 480, y: 460 };
      const dir = d.x < SHARED.W / 2 ? 1 : -1;
      return { x: d.x + dir * 85, y: Math.max(SHARED.FLOOR.minY + 25, d.y) };
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SHARED;
  else root.SHARED = SHARED;
})(this);
