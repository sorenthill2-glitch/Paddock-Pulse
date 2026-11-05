// Preset layout engine. Given which panels are on and the workspace size, returns a tidy
// arrangement: {id: {x, y, w, h}}. Rules:
//  - Timing is never cut: it is a full-height column on the left (all driver rows visible).
//  - Map and F1 TV boxes get the big area. Tiles, race control, radio and watch sit in a short strip
//    below them (newest-first feeds do not need height), or in a right column when the window is narrow.
//  - Everything stays inside the window and nothing overlaps.
(function (root) {
  const M = 8, G = 8;
  const MIN = { tiles: 420, rc: 260, radio: 260, watch: 240 };
  const WEIGHT = { tiles: 1.7, rc: 1, radio: 1, watch: .6 };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const R = v => Math.round(v);

  // split a total width into parts by weight, honouring minimums
  function shares(keys, total) {
    const fixed = {}; let free = keys.slice(), left = total - G * (keys.length - 1);
    for (let pass = 0; pass < keys.length; pass++) {
      const wsum = free.reduce((s, k) => s + WEIGHT[k], 0); let moved = false;
      for (const k of free.slice()) {
        const w = left * WEIGHT[k] / wsum;
        if (w < MIN[k]) { fixed[k] = MIN[k]; left -= MIN[k]; free = free.filter(x => x !== k); moved = true; break; }
      }
      if (!moved) break;
    }
    const wsum = free.reduce((s, k) => s + WEIGHT[k], 0) || 1;
    const out = {}; for (const k of keys) out[k] = fixed[k] ?? left * WEIGHT[k] / wsum;
    return out;
  }

  // lay items out in a grid inside rect; the last row is stretched to full width
  function grid(items, rect, cols, out) {
    const n = items.length, rows = Math.ceil(n / cols), ch = (rect.h - G * (rows - 1)) / rows;
    let i = 0;
    for (let r = 0; r < rows; r++) {
      const inRow = Math.min(cols, n - i), cw = (rect.w - G * (inRow - 1)) / inRow;
      for (let c = 0; c < inRow; c++, i++) out[items[i]] = { x: R(rect.x + c * (cw + G)), y: R(rect.y + r * (ch + G)), w: R(cw), h: R(ch) };
    }
  }

  function mediaAreaEven(media, rect, out) {
    const n = media.length;
    if (!n) return;
    if (n === 1) { out[media[0]] = { x: R(rect.x), y: R(rect.y), w: R(rect.w), h: R(rect.h) }; return; }
    const hasMap = media[0] === 'map', wide = rect.w / rect.h >= 1.25;
    if (n === 2) {
      if (wide) {
        const a = hasMap ? .42 : .5, w1 = (rect.w - G) * a;
        out[media[0]] = { x: R(rect.x), y: R(rect.y), w: R(w1), h: R(rect.h) };
        out[media[1]] = { x: R(rect.x + w1 + G), y: R(rect.y), w: R(rect.w - w1 - G), h: R(rect.h) };
      } else {
        const a = hasMap ? .5 : .5, h1 = (rect.h - G) * a;
        out[media[0]] = { x: R(rect.x), y: R(rect.y), w: R(rect.w), h: R(h1) };
        out[media[1]] = { x: R(rect.x), y: R(rect.y + h1 + G), w: R(rect.w), h: R(rect.h - h1 - G) };
      }
      return;
    }
    if (n === 3 && hasMap && wide) { // map on the left, two boxes stacked on the right
      const w1 = (rect.w - G) * .38;
      out.map = { x: R(rect.x), y: R(rect.y), w: R(w1), h: R(rect.h) };
      const h2 = (rect.h - G) / 2, x2 = rect.x + w1 + G, w2 = rect.w - w1 - G;
      out[media[1]] = { x: R(x2), y: R(rect.y), w: R(w2), h: R(h2) };
      out[media[2]] = { x: R(x2), y: R(rect.y + h2 + G), w: R(w2), h: R(rect.h - h2 - G) };
      return;
    }
    // pick the column count that keeps every cell usable (prefer fewer, bigger cells)
    let cols = n <= 4 ? 2 : 3;
    for (const c of [2, 3]) {
      if (c < Math.ceil(n / 3) || c > n) continue;
      const rows = Math.ceil(n / c);
      if ((rect.w - G * (c - 1)) / c >= 300 && (rect.h - G * (rows - 1)) / rows >= 200) { cols = c; break; }
    }
    grid(media, rect, cols, out);
  }

  // F1 TV boxes are sized so their video area is 16:9 (no empty bars at the sides); the map takes the rest.
  const CHROME = 34; // panel title bar + borders
  function mediaArea(media, rect, out) {
    const tvs = media.filter(k => k !== 'map'), hasMap = media.includes('map'), k = tvs.length;
    if (!k) return mediaAreaEven(media, rect, out);
    const mapMin = hasMap ? Math.max(300, Math.min(480, rect.w * .3)) : 0;
    const avail = hasMap ? Math.min(rect.w - mapMin - G, rect.w * .62) : rect.w;
    let best = null;
    for (let r = 1; r <= k; r++) {
      const c = Math.ceil(k / r), ch = (rect.h - G * (r - 1)) / r;
      const cw = Math.min((ch - CHROME) * 16 / 9, (avail - G * (c - 1)) / c);
      if (cw < 300) continue;
      if (!best || cw > best.cw) best = { r, c, cw, h: cw * 9 / 16 + CHROME };
    }
    if (!best) return mediaAreaEven(media, rect, out);
    const bw = best.c * best.cw + G * (best.c - 1);
    const bx = hasMap ? rect.x + rect.w - bw : rect.x + (rect.w - bw) / 2;
    if (hasMap) out.map = { x: R(rect.x), y: R(rect.y), w: R(bx - G - rect.x), h: R(rect.h) };
    tvs.forEach((id, i) => {
      const row = Math.floor(i / best.c), col = i % best.c;
      out[id] = { x: R(bx + col * (best.cw + G)), y: R(rect.y + row * (best.h + G)), w: R(best.cw), h: R(best.h) };
    });
  }

  // vis: {timing,map,tiles,rc,radio,watch: bool, tv: 0..4}; opt: {rows}
  function computeLayout(vis, W, H, opt) {
    opt = opt || {};
    const out = {};
    let x0 = M, y0 = M; const x1 = W - M, y1 = H - M;
    const feeds = ['rc', 'radio', 'watch'].filter(k => vis[k]);
    const media = []; if (vis.map) media.push('map'); for (let i = 1; i <= (vis.tv || 0); i++) media.push('tv' + i);
    const others = media.length || vis.tiles || feeds.length;
    if (vis.timing) {
      const w = others ? 340 : Math.min(560, x1 - x0);
      out.timing = { x: x0, y: y0, w, h: y1 - y0 };
      x0 += w + G;
    }
    const aw = x1 - x0, ah = y1 - y0;
    if (aw < 200 || ah < 120) return out;

    if (media.length) {
      const strip = (vis.tiles ? ['tiles'] : []).concat(feeds);
      if (!strip.length) { mediaArea(media, { x: x0, y: y0, w: aw, h: ah }, out); return out; }
      const minW = strip.reduce((s, k) => s + MIN[k], 0) + G * (strip.length - 1);
      const feedColumn = !vis.tiles && feeds.some(k => k !== 'watch'); // plain lists read better as a column than as a wide strip
      if (minW <= aw && !feedColumn) {
        const onlyWatch = strip.length === 1 && strip[0] === 'watch';
        const bh = onlyWatch ? 150 : clamp(R(ah * .3), 230, 340);
        mediaArea(media, { x: x0, y: y0, w: aw, h: ah - bh - G }, out);
        const sw = shares(strip, aw); let x = x0;
        for (const k of strip) { out[k] = { x: R(x), y: R(y1 - bh), w: R(sw[k]), h: bh }; x += sw[k] + G; }
      } else { // narrow window: strip items become a right-hand column
        const fw = clamp(R(aw * .3), 300, 380);
        mediaArea(media, { x: x0, y: y0, w: aw - fw - G, h: ah }, out);
        stack(strip, { x: x1 - fw, y: y0, w: fw, h: ah }, out);
      }
      return out;
    }

    if (vis.tiles) { // no map / video: tiles take the middle, feeds go in a right column
      if (!feeds.length) { out.tiles = { x: x0, y: y0, w: aw, h: ah }; return out; }
      const fw = clamp(R(aw * .3), 300, 400);
      out.tiles = { x: x0, y: y0, w: aw - fw - G, h: ah };
      stack(feeds, { x: x1 - fw, y: y0, w: fw, h: ah }, out);
      return out;
    }

    if (feeds.length) { // feeds only: side by side at a readable width
      const each = Math.min(560, (aw - G * (feeds.length - 1)) / feeds.length);
      let x = x0;
      for (const k of feeds) { const w = k === 'watch' ? Math.min(300, each) : each; out[k] = { x: R(x), y: y0, w: R(w), h: k === 'watch' ? 190 : ah }; x += w + G; }
    }
    return out;
  }

  // stack items vertically in a column: watch is short, the feeds share the rest
  function stack(keys, rect, out) {
    const hasWatch = keys.includes('watch'), main = keys.filter(k => k !== 'watch');
    let top = rect.y, avail = rect.h - (hasWatch ? 150 + G : 0);
    const wts = { tiles: 1.4, rc: 1, radio: 1 }, wsum = main.reduce((s, k) => s + wts[k], 0), gaps = G * (main.length - 1);
    for (const k of main) { const h = (avail - gaps) * wts[k] / wsum; out[k] = { x: R(rect.x), y: R(top), w: R(rect.w), h: R(h) }; top += h + G; }
    if (hasWatch) out.watch = { x: R(rect.x), y: R(rect.y + rect.h - 150), w: R(rect.w), h: 150 };
  }

  root.PPLayout = { computeLayout };
  if (typeof module !== 'undefined') module.exports = root.PPLayout;
})(typeof window !== 'undefined' ? window : globalThis);
