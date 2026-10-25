/**
 * Procedural icon atlas: every good, UI glyph and achievement badge is a tiny vector painter
 * on a 16-unit grid, scaled to the requested size. No emoji, no fonts, no asset files.
 *
 * Style rules (keep new glyphs coherent): flat fills from the palette below, one ink outline
 * of OUTLINE units, round joins, nothing thinner than ~1 unit, and at most a handful of shapes.
 * Line-art parts use `bar` (ink casing under a coloured stroke) so they read on walnut and paper.
 *
 * To add a glyph, add one painter to PAINTERS; ICON_IDS picks it up.
 */

type Ctx = CanvasRenderingContext2D;
export type IconId = string;

/** Palette: the theme.css brass/ink/paper tokens, plus a few muted material tones. */
const C = {
  ink: '#1d1a16',
  walnut: '#2b1d14',
  brass: '#c9a227',
  brassDark: '#8a6d17',
  brassLight: '#e8c75a',
  paper: '#f3e9d2',
  paperShade: '#e4d5b2',
  blue: '#2f6fb5', // --player
  red: '#b5302f', // --rival / --bad
  green: '#3c8d3c', // --good
  steel: '#9aa4ae',
  slate: '#55504a',
  coal: '#3a3631',
  hat: '#625b52',
  glass: '#a9cfd0',
  orange: '#d9822b',
  crust: '#c98a3e',
  smoke: '#8f887c',
  // R4 material tones
  copper: '#c46f3b',
  copperLight: '#e8a06a',
  verdigris: '#4f8a6e',
  verdigrisLight: '#8cc7a6',
  clay: '#b5653d',
  clayLight: '#d9946a',
  ochre: '#d08a5a',
  rust: '#7e3a1e',
  hide: '#b08060',
  leather: '#8a5530',
  pink: '#e8609a',
  pinkLight: '#ffa6c9',
  maroon: '#8a3350',
  lime: '#9bcf3c',
  teal: '#2f8f83',
  screen: '#1a8fb0',
  wafer: '#6b7fa3',
  amber: '#ffb347',
  purple: '#7b3fe4',
  navy: '#34466e',
  lcd: '#a8c890',
  frost: '#e6edf2',
} as const;

const OUTLINE = 1.2;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- helpers (16-unit grid)

/** Fill the current path, then outline it in ink. */
function fs(g: Ctx, fill: string, stroke = true): void {
  g.fillStyle = fill;
  g.fill();
  if (stroke) g.stroke();
}

function poly(g: Ctx, pts: number[], fill: string, stroke = true): void {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
  fs(g, fill, stroke);
}

function rect(g: Ctx, x: number, y: number, w: number, h: number, fill: string, stroke = true): void {
  g.beginPath();
  g.rect(x, y, w, h);
  fs(g, fill, stroke);
}

function rrectPath(g: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function rrect(g: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string, stroke = true): void {
  rrectPath(g, x, y, w, h, r);
  fs(g, fill, stroke);
}

function circ(g: Ctx, cx: number, cy: number, r: number, fill: string, stroke = true): void {
  g.beginPath();
  g.arc(cx, cy, r, 0, TAU);
  fs(g, fill, stroke);
}

function ell(g: Ctx, cx: number, cy: number, rx: number, ry: number, fill: string, rot = 0, stroke = true): void {
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, rot, 0, TAU);
  fs(g, fill, stroke);
}

/** Open polyline stroke in one colour (no casing): for detail lines on light fills. */
function line(g: Ctx, pts: number[], color: string, width = 1): void {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.strokeStyle = color;
  g.lineWidth = width;
  g.stroke();
  g.strokeStyle = C.ink;
  g.lineWidth = OUTLINE;
}

/** Thick line-art stroke: ink casing under a coloured core, legible on any background. */
function bar(g: Ctx, pts: number[], color: string, width = 2): void {
  line(g, pts, C.ink, width + OUTLINE * 2);
  line(g, pts, color, width);
}

/** Wheel: dark tyre with a paper hub. */
function wheel(g: Ctx, cx: number, cy: number, r: number): void {
  circ(g, cx, cy, r, C.coal);
  circ(g, cx, cy, r * 0.4, C.paperShade, false);
}

/** Shapes merged into one silhouette: ink casing for all, then fills on top. */
function blob(g: Ctx, circles: [number, number, number][], fill: string): void {
  g.lineWidth = OUTLINE * 2;
  for (const [x, y, r] of circles) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke(); }
  g.lineWidth = OUTLINE;
  for (const [x, y, r] of circles) circ(g, x, y, r, fill, false);
}

// ---------------------------------------------------------------- painters

type Painter = (g: Ctx) => void;

const GOOD_PAINTERS: Record<string, Painter> = {
  wood: (g) => {
    // log on its side: bark body, pale end grain
    g.beginPath();
    g.moveTo(12, 3.5);
    g.lineTo(3.5, 3.5);
    g.ellipse(3.5, 8, 2, 4.5, 0, -Math.PI / 2, Math.PI / 2, true);
    g.lineTo(12, 12.5);
    g.closePath();
    fs(g, C.brassDark);
    ell(g, 12, 8, 2.6, 4.5, C.paperShade);
    ell(g, 12, 8, 1, 1.8, C.crust, 0, false);
  },
  grain: (g) => {
    bar(g, [8, 15, 8, 4], C.brassDark, 1.2);
    for (const [x, y, rot] of [[6.2, 10, -0.5], [9.8, 10, 0.5], [6.2, 6.5, -0.5], [9.8, 6.5, 0.5]]) {
      ell(g, x, y, 1.4, 2.4, C.brassLight, rot);
    }
    ell(g, 8, 3.2, 1.4, 2.3, C.brassLight);
  },
  cotton: (g) => {
    poly(g, [5, 14.5, 8, 11, 11, 14.5], C.brassDark);
    blob(g, [[5, 8.5, 3], [11, 8.5, 3], [8, 5.5, 3.2], [8, 10, 3]], C.paper);
  },
  fruit: (g) => {
    bar(g, [8, 5, 8.8, 1.8], C.brassDark, 1.2);
    blob(g, [[6, 9.5, 4.6], [10, 9.5, 4.6]], C.red);
    ell(g, 11.2, 3.4, 2.2, 1.1, C.green, -0.5);
    ell(g, 5.6, 8.2, 0.9, 1.6, C.paper, 0, false);
  },
  milk: (g) => {
    poly(g, [6.5, 3, 9.5, 3, 9.5, 5.5, 12, 8, 12, 14.5, 4, 14.5, 4, 8, 6.5, 5.5], C.paper);
    rect(g, 4, 9.5, 8, 2.8, C.blue);
    rect(g, 6, 1.5, 4, 2, C.brass);
  },
  iron_ore: (g) => {
    poly(g, [1.5, 11, 3.5, 6, 8, 3.5, 12.5, 4.5, 14.5, 9, 13, 13.5, 8, 14.5, 3, 13.5], C.slate);
    circ(g, 6, 9, 1.4, C.orange, false);
    circ(g, 10.2, 7, 1.2, C.orange, false);
    circ(g, 10.5, 11.2, 1.2, C.orange, false);
  },
  coal: (g) => {
    poly(g, [4.5, 8.5, 6, 4.5, 9.5, 3.5, 11.5, 6.5, 9.5, 9, 6, 9.5], C.slate);
    poly(g, [1.5, 13.5, 2.5, 9.5, 6, 8, 8.5, 10.5, 7.5, 14], C.slate);
    poly(g, [8, 14, 8.5, 9.5, 11.5, 8, 14.5, 10.5, 13.5, 14], C.slate);
    line(g, [6.8, 5.2, 9, 4.6], C.paperShade, 1.1);
    line(g, [3.2, 10, 5.6, 9.1], C.paperShade, 1.1);
    line(g, [9.4, 10, 11.4, 9.1], C.paperShade, 1.1);
  },
  sand: (g) => {
    g.beginPath();
    g.moveTo(1, 13.5);
    g.bezierCurveTo(4, 4.5, 12, 4.5, 15, 13.5);
    g.closePath();
    fs(g, C.brassLight);
    for (const [x, y] of [[6, 10.5], [9, 9], [10.8, 11.8], [7.2, 12.3], [8, 7]]) circ(g, x, y, 0.65, C.brassDark, false);
  },
  oil: (g) => {
    rrect(g, 3.5, 2, 9, 12.5, 1.6, C.slate);
    rect(g, 3.5, 4.2, 9, 1.4, C.brass, false);
    rect(g, 3.5, 11, 9, 1.4, C.brass, false);
    // paper oil drop
    g.beginPath();
    g.moveTo(8, 6.3);
    g.quadraticCurveTo(9.6, 8, 9.4, 9);
    g.arc(8, 9, 1.4, 0, Math.PI);
    g.quadraticCurveTo(6.4, 8, 8, 6.3);
    fs(g, C.paper, false);
  },
  lumber: (g) => {
    rect(g, 1.5, 10.5, 13, 3, C.brassLight);
    rect(g, 3, 7.5, 11.5, 3, C.brass);
    rect(g, 1.5, 4.5, 11.5, 3, C.brassLight);
  },
  flour: (g) => {
    poly(g, [5.5, 2, 10.5, 2, 9.5, 4.5, 12.5, 7, 13, 13, 11.5, 14.5, 4.5, 14.5, 3, 13, 3.5, 7, 6.5, 4.5], C.paper);
    bar(g, [6.2, 4.7, 9.8, 4.7], C.brassDark, 1.4);
    ell(g, 8, 10, 2.2, 2.2, C.paperShade, 0, false);
  },
  steel: (g) => {
    poly(g, [2, 2.5, 14, 2.5, 14, 5.5, 9.5, 5.5, 9.5, 10.5, 14, 10.5, 14, 13.5, 2, 13.5, 2, 10.5, 6.5, 10.5, 6.5, 5.5, 2, 5.5], C.steel);
  },
  fabric: (g) => {
    poly(g, [4, 10, 12.5, 10, 14.5, 14.5, 5.5, 14.5], C.blue);
    g.beginPath();
    g.moveTo(12, 3);
    g.lineTo(4, 3);
    g.ellipse(4, 7, 1.8, 4, 0, -Math.PI / 2, Math.PI / 2, true);
    g.lineTo(12, 11);
    g.closePath();
    fs(g, C.blue);
    ell(g, 12, 7, 1.8, 4, C.paperShade);
    circ(g, 12, 7, 0.7, C.brassDark, false);
  },
  glass: (g) => {
    rrect(g, 2, 2, 12, 12, 1, C.brassDark);
    for (const [x, y] of [[3.5, 3.5], [8.5, 3.5], [3.5, 8.5], [8.5, 8.5]]) rect(g, x, y, 4, 4, C.glass);
    line(g, [4.3, 6.6, 6.6, 4.3], C.paper, 1);
    line(g, [9.3, 11.6, 11.6, 9.3], C.paper, 1);
  },
  fuel: (g) => {
    rrect(g, 5, 1.5, 5.5, 3.5, 1, C.red);
    poly(g, [11, 4, 13, 1.2, 14.6, 2.3, 12.6, 5], C.steel);
    rrect(g, 3, 4, 10, 10.5, 1.5, C.red);
    line(g, [5.5, 6.8, 10.5, 11.8], '#7e2120', 1.2);
    line(g, [10.5, 6.8, 5.5, 11.8], '#7e2120', 1.2);
  },
  plastic: (g) => {
    const flask = [6.5, 2, 9.5, 2, 9.5, 6, 13.5, 13, 12.5, 14.5, 3.5, 14.5, 2.5, 13, 6.5, 6];
    poly(g, flask, C.glass);
    poly(g, [4.2, 10, 11.8, 10, 13.5, 13, 12.5, 14.5, 3.5, 14.5, 2.5, 13], C.green, false);
    poly(g, flask, 'rgba(0,0,0,0)');
    bar(g, [5.6, 2, 10.4, 2], C.paperShade, 1.2);
  },
  furniture: (g) => {
    bar(g, [4, 10, 4, 14.5], C.brassDark, 1.6);
    bar(g, [12, 10, 12, 14.5], C.brassDark, 1.6);
    rect(g, 4, 1.5, 8, 6.5, C.brassDark);
    rect(g, 6.5, 3, 3, 3.5, C.crust, false);
    rect(g, 2.5, 8, 11, 2.5, C.crust);
  },
  bread: (g) => {
    g.beginPath();
    g.moveTo(1.5, 12.5);
    g.lineTo(1.5, 9.5);
    g.bezierCurveTo(1.5, 3, 14.5, 3, 14.5, 9.5);
    g.lineTo(14.5, 12.5);
    g.closePath();
    fs(g, C.crust);
    for (const x of [4.5, 7.5, 10.5]) line(g, [x, 6.8, x + 1.5, 9.5], C.paperShade, 1.1);
  },
  tools: (g) => {
    g.save();
    g.translate(8, 8);
    g.rotate(-Math.PI / 4);
    rrect(g, -1.4, -2.5, 2.8, 10, 0.6, C.brassDark);
    rrect(g, -5.5, -6, 11, 3.8, 0.8, C.steel);
    g.restore();
  },
  clothes: (g) => {
    poly(g, [5.5, 2, 10.5, 2, 14.5, 5, 12.8, 8, 11.5, 7.2, 11.5, 14.5, 4.5, 14.5, 4.5, 7.2, 3.2, 8, 1.5, 5], C.blue);
    poly(g, [5.5, 2, 8, 5, 10.5, 2], C.paper);
    circ(g, 8, 8, 0.7, C.paper, false);
    circ(g, 8, 11, 0.7, C.paper, false);
  },
  cheese: (g) => {
    poly(g, [1.5, 8, 10, 3.5, 14.5, 8], C.brassLight);
    rect(g, 1.5, 8, 13, 5.5, C.brass);
    circ(g, 5, 10.8, 1.1, C.brassDark, false);
    circ(g, 10, 10.3, 1.3, C.brassDark, false);
    circ(g, 12.8, 12.1, 0.7, C.brassDark, false);
    circ(g, 9, 6, 0.8, C.brass, false);
  },
  juice: (g) => {
    bar(g, [9.5, 8, 12, 1.5], C.red, 1.3);
    const cup = [3.5, 4, 12.5, 4, 11.5, 14.5, 4.5, 14.5];
    poly(g, cup, C.glass);
    poly(g, [3.8, 7, 12.2, 7, 11.5, 14.5, 4.5, 14.5], C.orange, false);
    poly(g, cup, 'rgba(0,0,0,0)');
  },
  toys: (g) => {
    circ(g, 3.8, 4.2, 2.3, C.brassDark);
    circ(g, 12.2, 4.2, 2.3, C.brassDark);
    circ(g, 8, 9, 5.5, C.brassDark);
    ell(g, 8, 11.2, 2.5, 1.9, C.paperShade);
    circ(g, 8, 10.4, 0.9, C.ink, false);
    circ(g, 5.9, 7.5, 0.85, C.ink, false);
    circ(g, 10.1, 7.5, 0.85, C.ink, false);
  },
  cars: (g) => {
    poly(g, [1.5, 11.5, 1.5, 8.5, 4, 8, 5.5, 4.5, 10.5, 4.5, 12, 8, 14.5, 8.5, 14.5, 11.5], C.red);
    poly(g, [6.3, 5.6, 9.7, 5.6, 10.6, 8, 5.4, 8], C.glass);
    wheel(g, 4.5, 12, 2.2);
    wheel(g, 11.5, 12, 2.2);
  },
  radios: (g) => {
    g.beginPath();
    g.moveTo(2.5, 14.5);
    g.lineTo(2.5, 7.5);
    g.arc(8, 7.5, 5.5, Math.PI, 0);
    g.lineTo(13.5, 14.5);
    g.closePath();
    fs(g, C.brassDark);
    g.beginPath();
    g.moveTo(5, 10.5);
    g.lineTo(5, 7.5);
    g.arc(8, 7.5, 3, Math.PI, 0);
    g.lineTo(11, 10.5);
    g.closePath();
    fs(g, C.paperShade);
    for (const x of [6.5, 8, 9.5]) line(g, [x, 5.5, x, 10.3], C.brassDark, 0.9);
    circ(g, 5.5, 12.6, 0.9, C.brassLight, false);
    circ(g, 10.5, 12.6, 0.9, C.brassLight, false);
  },
  tvs: (g) => {
    bar(g, [8, 4.5, 5, 1.2], C.steel, 0.9);
    bar(g, [8, 4.5, 11, 1.2], C.steel, 0.9);
    rrect(g, 1.5, 4.5, 13, 10, 1.5, C.slate);
    rrect(g, 3, 6, 8, 7, 1.5, C.glass);
    circ(g, 12.8, 8, 0.8, C.brass, false);
    circ(g, 12.8, 11, 0.8, C.brass, false);
  },
  computers: (g) => {
    rect(g, 6.5, 10.5, 3, 2, C.paperShade);
    rrect(g, 2, 1.5, 12, 9, 1, C.paperShade);
    rect(g, 3.5, 3, 9, 6, '#1f2e22');
    line(g, [4.8, 4.8, 9, 4.8], '#7fe07f', 1);
    line(g, [4.8, 7, 10.8, 7], '#7fe07f', 1);
    rrect(g, 1.5, 12.5, 13, 2.5, 0.6, C.paperShade);
  },
  // R4 goods
  copper_ore: (g) => {
    // a green-stained lump with copper nuggets
    poly(g, [1.5, 12, 3, 6.5, 7, 3.5, 11.5, 3, 14.5, 6.5, 14.5, 11, 11, 14.5, 4.5, 14.5], C.verdigris);
    line(g, [4, 7, 6.8, 4.8], C.verdigrisLight, 1.1);
    poly(g, [4.8, 10.2, 7.2, 7.6, 9.4, 9, 7.4, 11.8], C.copper, false);
    circ(g, 11.4, 6.6, 1.2, C.copperLight, false);
    circ(g, 11, 11.4, 1.2, C.copper, false);
  },
  cattle: (g) => {
    // a cow's head: curved horns, ears out, white blaze, pale muzzle
    bar(g, [5.2, 4.2, 2.6, 3.4, 1.8, 1.2], C.paper, 1.2);
    bar(g, [10.8, 4.2, 13.4, 3.4, 14.2, 1.2], C.paper, 1.2);
    ell(g, 3, 6.6, 2.1, 1.1, C.leather, -0.35);
    ell(g, 13, 6.6, 2.1, 1.1, C.leather, 0.35);
    poly(g, [4.5, 4, 11.5, 4, 11.5, 9, 10.6, 12, 5.4, 12, 4.5, 9], C.leather);
    poly(g, [7, 4, 9, 4, 8.6, 9.5, 7.4, 9.5], C.paper, false);
    rrect(g, 4.6, 10.4, 6.8, 4.4, 2, '#e0b8a0');
    circ(g, 6.6, 12.6, 0.7, C.ink, false);
    circ(g, 9.4, 12.6, 0.7, C.ink, false);
    circ(g, 5.9, 7, 0.75, C.ink, false);
    circ(g, 10.1, 7, 0.75, C.ink, false);
  },
  sugar_beet: (g) => {
    // a fat tapering root under a tuft of leaves
    ell(g, 5.6, 4.2, 1.5, 3.2, C.green, -0.55);
    ell(g, 10.4, 4.2, 1.5, 3.2, C.green, 0.55);
    ell(g, 8, 3.4, 1.5, 3, C.green);
    g.beginPath();
    g.moveTo(8, 15.2);
    g.bezierCurveTo(4.6, 12.6, 2.6, 10, 3.8, 8);
    g.bezierCurveTo(5.2, 6.2, 10.8, 6.2, 12.2, 8);
    g.bezierCurveTo(13.4, 10, 11.4, 12.6, 8, 15.2);
    fs(g, '#d98aa8');
    line(g, [5.4, 9, 6.6, 11.6], C.paper, 1);
  },
  clay: (g) => {
    // a soft lump of wet red clay, a wire-cut sliver lifting off and thumb dents
    g.beginPath();
    g.moveTo(1.5, 13.5);
    g.bezierCurveTo(0.8, 9, 3.5, 6.6, 6, 6.8);
    g.bezierCurveTo(7.6, 3.4, 12.8, 3.6, 13.6, 7.4);
    g.bezierCurveTo(15.4, 9.4, 15, 12.6, 14, 13.5);
    g.closePath();
    fs(g, C.clay);
    line(g, [4.2, 9.4, 6.4, 7.8], C.clayLight, 1.2);
    line(g, [8.6, 6.2, 11.4, 5.6], C.clayLight, 1.2);
    ell(g, 6, 11.2, 1.4, 1, C.rust, 0.3, false);
    ell(g, 10.6, 10, 1.4, 1, C.rust, -0.3, false);
    line(g, [1.5, 13.5, 14, 13.5], C.ink, OUTLINE);
  },
  rubber: (g) => {
    // a tapped tree: latex runs down the spiral cut and drips into a cup
    rect(g, 1, 0.5, 5.5, 15, C.brassDark);
    line(g, [1.8, 3.6, 5.8, 6.6], C.paper, 1.3);
    g.beginPath();
    g.moveTo(10.8, 6.4);
    g.quadraticCurveTo(12.8, 8.8, 12.6, 9.4);
    g.arc(10.8, 9.4, 1.8, 0, Math.PI);
    g.quadraticCurveTo(8.8, 8.8, 10.8, 6.4);
    fs(g, C.paper);
    g.beginPath();
    g.moveTo(6.8, 11.6);
    g.lineTo(15, 11.6);
    g.quadraticCurveTo(14.6, 15.2, 10.9, 15.2);
    g.quadraticCurveTo(7.2, 15.2, 6.8, 11.6);
    g.closePath();
    fs(g, C.crust);
    ell(g, 10.9, 11.7, 3.6, 0.9, C.paper);
  },
  bauxite: (g) => {
    // ochre pebbles studded with dark pisolites
    blob(g, [[4.8, 10.4, 3.5], [11, 10.6, 3.5], [8, 5.8, 3.4], [8, 10, 2.8]], C.ochre);
    for (const [x, y, r] of [[4.4, 11, 0.9], [7.6, 5.4, 0.9], [11.6, 11.4, 1], [9.6, 8.6, 0.75], [7, 12.6, 0.7], [12, 8.6, 0.6]]) circ(g, x, y, r, C.rust, false);
    line(g, [5.8, 4.8, 7.6, 3.6], C.paper, 0.9);
  },
  copper: (g) => {
    // a cast ingot: lit top face, sloped front
    poly(g, [1.5, 13.5, 3.4, 8.5, 12.6, 8.5, 14.5, 13.5], C.copper);
    poly(g, [3.4, 8.5, 5.4, 4, 10.6, 4, 12.6, 8.5], C.copperLight);
    line(g, [6.4, 5.6, 9.6, 5.6], C.paper, 1);
    line(g, [4.6, 11.4, 11.4, 11.4], C.rust, 1);
  },
  leather: (g) => {
    // a stretched hide: four splayed legs, a neck and a tail, a paler flesh side
    poly(g, [6.6, 1, 9.4, 1, 10.2, 3.2, 14.8, 2.2, 12.6, 6, 13.2, 10, 15, 13.8, 10.4, 12.6, 8.8, 15.2, 7.2, 15.2, 5.6, 12.6, 1, 13.8, 2.8, 10, 3.4, 6, 1.2, 2.2, 5.8, 3.2], C.hide);
    poly(g, [8, 4.2, 10.6, 5.6, 11, 9, 10, 11.6, 8, 12.6, 6, 11.6, 5, 9, 5.4, 5.6], '#d2ab88', false);
  },
  sugar: (g) => {
    // a sugarloaf, its base wrapped in blue paper
    g.beginPath();
    g.moveTo(3.5, 14.5);
    g.lineTo(7, 2.6);
    g.quadraticCurveTo(8, 0.9, 9, 2.6);
    g.lineTo(12.5, 14.5);
    g.closePath();
    fs(g, C.paper);
    poly(g, [5, 9.4, 11, 9.4, 12.5, 14.5, 3.5, 14.5], C.blue);
    line(g, [6.6, 4.4, 5.4, 8.4], C.paperShade, 1);
    line(g, [8.5, 9.4, 8.5, 14.5], '#24578f', 1);
  },
  bricks: (g) => {
    // a stack of three bricks, two below and one across the top, lit top faces
    for (const [x, y] of [[0.8, 10.2], [7.8, 10.2], [4.3, 5]]) {
      poly(g, [x, y, x + 1.6, y - 1.8, x + 8.6, y - 1.8, x + 7, y], '#d4614e');
      poly(g, [x, y, x + 7, y, x + 7, y + 4.2, x, y + 4.2], C.red);
      poly(g, [x + 7, y, x + 8.6, y - 1.8, x + 8.6, y + 2.4, x + 7, y + 4.2], '#7e2120');
    }
  },
  paper: (g) => {
    // a ream: a stack of sheets fanned out, the top one ruled
    rect(g, 1.5, 6.5, 10, 8, C.paperShade);
    rect(g, 3, 4.5, 10, 8, C.paperShade);
    rect(g, 4.5, 2.5, 10, 8, C.paper);
    for (const [x1, y] of [[13, 4.8], [13, 6.6], [10.6, 8.4]]) line(g, [6, y, x1, y], C.smoke, 0.9);
  },
  chemicals: (g) => {
    // a round-bottomed flask of bubbling lime liquor
    rect(g, 6.4, 2.5, 3.2, 5.5, C.glass);
    circ(g, 8, 10.5, 4.6, C.glass);
    g.beginPath();
    g.arc(8, 10.5, 4.6, -0.2, Math.PI + 0.2);
    g.closePath();
    fs(g, C.lime, false);
    g.beginPath();
    g.arc(8, 10.5, 4.6, 0, TAU);
    g.stroke();
    bar(g, [5.6, 2.5, 10.4, 2.5], C.paperShade, 1.2);
    circ(g, 6.4, 11.4, 0.8, C.paper, false);
    circ(g, 9.4, 12.6, 0.6, C.paper, false);
    circ(g, 11.8, 2.6, 1.1, C.lime);
    circ(g, 13.4, 5, 0.8, C.lime);
  },
  aluminium: (g) => {
    // two bright sheets, one leant on the other, with a cold sheen
    poly(g, [5, 1.5, 14.5, 1.5, 12, 11, 2.5, 11], C.steel);
    poly(g, [3.5, 5, 13, 5, 10.5, 14.5, 1, 14.5], '#c9d1d9');
    line(g, [5.2, 12.8, 7.4, 6.8], C.paper, 1.2);
    line(g, [8, 12.8, 9.2, 9.4], C.paper, 1);
  },
  silicon: (g) => {
    // a wafer with its flat, ruled into dies
    g.beginPath();
    g.arc(8, 8, 6.8, Math.PI / 2 + 0.55, Math.PI / 2 - 0.55 + TAU);
    g.closePath();
    fs(g, C.wafer);
    for (const v of [5.3, 8, 10.7]) {
      line(g, [v, 3, v, 13], '#a9b9d6', 0.8);
      line(g, [2.6, v, 13.4, v], '#a9b9d6', 0.8);
    }
    line(g, [4.6, 5.8, 6.6, 3.6], C.paper, 1.2);
  },
  wire: (g) => {
    // a spool of copper wire between wooden flanges, the loose end trailing
    rect(g, 4, 3.5, 8, 9, C.copper);
    for (const y of [5.5, 7.5, 9.5]) line(g, [4.6, y, 11.4, y + 0.8], C.rust, 0.9);
    line(g, [5, 4.8, 11, 4.8], C.copperLight, 1);
    rrect(g, 1.5, 1.5, 3, 13, 1, C.brassDark);
    rrect(g, 11.5, 1.5, 3, 13, 1, C.brassDark);
    bar(g, [13, 12.5, 15, 15], C.copper, 1);
  },
  tyres: (g) => {
    // a whitewall tyre on a steel rim
    circ(g, 8, 8, 7, C.coal);
    g.beginPath();
    g.arc(8, 8, 4.9, 0, TAU);
    g.strokeStyle = C.paperShade;
    g.lineWidth = 1.3;
    g.stroke();
    g.strokeStyle = C.ink;
    g.lineWidth = OUTLINE;
    circ(g, 8, 8, 3.3, C.steel);
    circ(g, 8, 8, 1.2, C.slate, false);
  },
  engines: (g) => {
    // an engine block: red rocker cover, a belt pulley, an oil sump
    rect(g, 1.5, 6, 10, 6.5, C.steel);
    rrect(g, 2.5, 2.8, 8, 3.2, 1, C.red);
    for (const x of [4.5, 6.5, 8.5]) circ(g, x, 4.4, 0.6, '#7e2120', false);
    poly(g, [3, 12.5, 10, 12.5, 9, 14.8, 4, 14.8], C.slate);
    for (const y of [8.2, 10.3]) line(g, [2.6, y, 10.4, y], C.smoke, 0.9);
    circ(g, 12.6, 9.4, 2.6, C.slate);
    circ(g, 12.6, 9.4, 0.9, C.paperShade, false);
  },
  electric_motors: (g) => {
    // a finned blue motor on its feet, the shaft out of the end bell
    rect(g, 3.5, 12, 7, 2.6, C.slate);
    rrect(g, 1.5, 3.5, 10, 9, 2, '#3e7cb1');
    for (const x of [4, 6.5, 9]) line(g, [x, 5, x, 11], '#7fb0dc', 1);
    rect(g, 11.5, 5, 2, 6, C.steel);
    bar(g, [13.5, 8, 15.2, 8], C.steel, 1.4);
    rect(g, 4.5, 1.5, 3.5, 2, C.slate);
  },
  vacuum_tubes: (g) => {
    // a glass valve: anode plate, glowing filament, bakelite base and pins
    for (const x of [6, 10]) bar(g, [x, 13.5, x, 15.2], C.steel, 0.9);
    g.beginPath();
    g.moveTo(4, 11.5);
    g.lineTo(4, 5.5);
    g.arc(8, 5.5, 4, Math.PI, 0);
    g.lineTo(12, 11.5);
    g.closePath();
    fs(g, C.glass);
    circ(g, 8, 1.4, 0.8, C.glass);
    rect(g, 6, 4.5, 4, 6, C.slate);
    ell(g, 8, 7.5, 1, 2.2, C.amber, 0, false);
    rrect(g, 3.5, 11, 9, 3, 0.8, C.coal);
  },
  microchips: (g) => {
    // a black chip on three legs a side, its green die and pin-1 dot
    for (const y of [4.5, 8, 11.5]) {
      rect(g, 1.2, y - 0.8, 3, 1.6, C.steel);
      rect(g, 11.8, y - 0.8, 3, 1.6, C.steel);
    }
    rrect(g, 3.5, 1.5, 9, 13, 0.8, C.coal);
    rect(g, 6, 6, 4, 4, '#4fae3c');
    circ(g, 5.4, 3.5, 0.8, C.paperShade, false);
  },
  displays: (g) => {
    // a slim flat panel on a stand, a glint across the glass
    rect(g, 6.8, 11.5, 2.4, 2, C.slate);
    rect(g, 4, 13.3, 8, 1.6, C.slate);
    rrect(g, 0.8, 2, 14.4, 9.8, 0.8, C.slate);
    rect(g, 2.2, 3.4, 11.6, 7, C.screen);
    line(g, [3.8, 9, 7.4, 4.6], '#8fd6ea', 1.2);
    line(g, [6.6, 9, 9, 6], '#8fd6ea', 0.9);
  },
  shoes: (g) => {
    // a laced work boot on a dark sole
    poly(g, [4, 1.5, 9, 1.5, 9, 7.5, 13, 9.2, 14.5, 11, 14.5, 13, 2.5, 13, 2.5, 9, 4, 7.5], C.leather);
    rect(g, 2.5, 12.6, 12, 2.2, C.coal);
    rect(g, 3.6, 1.5, 5.8, 1.8, C.walnut);
    for (const y of [4.4, 6.4]) line(g, [5.4, y, 8.2, y], C.paperShade, 1);
    line(g, [8.6, 8.4, 10.6, 9.6], C.paperShade, 1);
  },
  candy: (g) => {
    // a wrapped sweet: twisted ends, a striped middle
    poly(g, [1, 4.5, 5, 8, 1, 11.5, 2.4, 8], C.pinkLight);
    poly(g, [15, 4.5, 11, 8, 15, 11.5, 13.6, 8], C.pinkLight);
    ell(g, 8, 8, 4.2, 3.6, C.pink);
    line(g, [6, 5, 8.6, 11], C.paper, 1.1);
    line(g, [8.6, 4.6, 10.8, 9.6], C.paper, 1.1);
  },
  books: (g) => {
    // a cloth-bound book, page edges showing, a brass title plate
    rect(g, 4, 3, 10.5, 12, C.paper);
    for (const y of [12.6, 13.8]) line(g, [5.4, y, 13.6, y], C.paperShade, 0.8);
    rect(g, 1.5, 1.5, 10.5, 12, C.maroon);
    rect(g, 1.5, 1.5, 2.2, 12, '#5e1f33', false);
    rect(g, 5, 4, 5, 2.4, C.brass);
    line(g, [5.4, 9, 9.6, 9], '#c9707e', 1);
  },
  canned_food: (g) => {
    // a tin can: steel ends, a red label with a white roundel
    g.beginPath();
    g.moveTo(3, 4);
    g.lineTo(3, 13);
    g.ellipse(8, 13, 5, 1.6, 0, Math.PI, 0, true);
    g.lineTo(13, 4);
    g.closePath();
    fs(g, C.steel);
    g.beginPath();
    g.moveTo(3, 6.2);
    g.lineTo(3, 11.2);
    g.ellipse(8, 11.2, 5, 1.6, 0, Math.PI, 0, true);
    g.lineTo(13, 6.2);
    g.ellipse(8, 6.2, 5, 1.6, 0, 0, Math.PI, false);
    g.closePath();
    fs(g, C.red, false);
    ell(g, 8, 9.3, 2.4, 1.6, C.paper, 0, false);
    ell(g, 8, 4, 5, 1.6, C.paperShade);
    ell(g, 8, 4, 3.4, 0.8, C.steel, 0, false);
  },
  phonographs: (g) => {
    // a gramophone: wooden case, the brass horn flaring up and out
    rect(g, 1.5, 10.5, 9.5, 4.2, C.brassDark);
    ell(g, 6, 10.4, 4, 1.1, C.coal, 0, false);
    poly(g, [7.6, 10, 9.4, 10.6, 15, 6.6, 10.4, 1], C.brass);
    ell(g, 12.7, 3.8, 1.9, 3.6, C.brassLight, -0.72);
    ell(g, 12.7, 3.8, 0.8, 1.7, C.brassDark, -0.72, false);
  },
  bicycles: (g) => {
    // a safety bicycle: two spoked rims, a diamond frame, saddle and bars
    for (const x of [3.8, 12.2]) {
      g.beginPath();
      g.arc(x, 11, 3.2, 0, TAU);
      g.lineWidth = 3.2;
      g.stroke();
      g.strokeStyle = C.slate;
      g.lineWidth = 1.2;
      g.stroke();
      g.strokeStyle = C.ink;
      g.lineWidth = OUTLINE;
      circ(g, x, 11, 0.8, C.steel, false);
    }
    bar(g, [3.8, 11, 6.6, 6.2, 8, 11, 3.8, 11], C.teal, 1.1);
    bar(g, [6.6, 6.2, 11, 6.2, 8, 11], C.teal, 1.1);
    bar(g, [11, 6.2, 12.2, 11], C.teal, 1.1);
    bar(g, [10.6, 4, 11, 6.2], C.steel, 0.9);
    bar(g, [9.6, 3.8, 12, 3.8], C.steel, 0.9);
    rrect(g, 4.6, 4, 3.4, 1.4, 0.6, C.coal);
  },
  motorcycles: (g) => {
    // a motorcycle: red tank, saddle, engine, front fork and lamp
    wheel(g, 3.6, 11.6, 2.9);
    wheel(g, 12.4, 11.6, 2.9);
    bar(g, [12.4, 11.6, 11.2, 5.4], C.steel, 1);
    rect(g, 5.8, 8.6, 4.2, 3.6, C.steel);
    poly(g, [3, 8.8, 5.2, 6, 11, 6, 12, 8.8], '#9a2a2a');
    rrect(g, 2.4, 4.8, 4.6, 1.8, 0.8, C.coal);
    bar(g, [10.2, 3.6, 12.2, 3.6], C.steel, 0.9);
    circ(g, 13.2, 6, 1.2, C.brassLight);
  },
  refrigerators: (g) => {
    // a two-door ice box: freezer above, steel handles
    rrect(g, 3.5, 1.5, 9, 13.5, 1.8, C.frost);
    line(g, [3.5, 6, 12.5, 6], C.ink, 1);
    bar(g, [10.4, 3, 10.4, 4.6], C.steel, 0.9);
    bar(g, [10.4, 7.6, 10.4, 10.6], C.steel, 0.9);
    line(g, [5, 7.8, 5, 13], '#ffffff', 1);
  },
  washing_machines: (g) => {
    // a front-loader: control strip, porthole door onto blue water
    rrect(g, 2, 1.5, 12, 13.5, 1.2, C.frost);
    rect(g, 2, 1.5, 12, 3, '#8fb8d8');
    g.beginPath();
    g.rect(2, 1.5, 12, 3);
    g.stroke();
    circ(g, 11.6, 3, 0.8, C.slate, false);
    circ(g, 8, 9.6, 4.2, C.steel);
    circ(g, 8, 9.6, 2.9, '#5f95c4');
    g.beginPath();
    g.arc(8, 9.6, 1.8, Math.PI * 0.9, Math.PI * 1.6);
    g.strokeStyle = C.paper;
    g.lineWidth = 1;
    g.stroke();
    g.strokeStyle = C.ink;
    g.lineWidth = OUTLINE;
  },
  cosmetics: (g) => {
    // a lipstick: brass case, the slanted pink bullet
    poly(g, [5.8, 6.5, 5.8, 3.6, 10.2, 1.2, 10.2, 6.5], '#d65a8c');
    rect(g, 5.2, 6.5, 5.6, 2.8, C.brassLight);
    rect(g, 4.5, 9.3, 7, 5.5, C.brass);
    line(g, [6, 10.5, 6, 13.6], C.brassLight, 1);
  },
  calculators: (g) => {
    // a desk calculator: a lit read-out over a grid of keys
    rrect(g, 2.5, 1.5, 11, 13.5, 1.2, '#707070');
    rect(g, 4, 3, 8, 3, C.lcd);
    line(g, [7.6, 4.5, 11, 4.5], '#3d5a2e', 1);
    for (const y of [7.6, 10, 12.4]) for (const x of [4.2, 6.9, 9.6]) rect(g, x, y, 2.2, 1.7, C.paper, false);
  },
  video_games: (g) => {
    // a gamepad: purple body with grips, cross pad and two buttons
    blob(g, [[4.4, 9.6, 3.4], [11.6, 9.6, 3.4], [8, 8, 3.4]], C.purple);
    rect(g, 4.4, 5.8, 7.2, 4, C.purple, false);
    rect(g, 2.6, 7.8, 3.6, 1.3, C.paper, false);
    rect(g, 3.75, 6.65, 1.3, 3.6, C.paper, false);
    circ(g, 11, 7.6, 1, C.red, false);
    circ(g, 12.8, 9.4, 1, C.brassLight, false);
  },
  mobile_phones: (g) => {
    // a brick handset: stub aerial, small screen, keypad
    bar(g, [10.6, 3.5, 10.6, 0.8], C.coal, 1.2);
    rrect(g, 4.5, 3, 7, 12, 1.4, C.navy);
    rect(g, 5.8, 4.4, 4.4, 2.8, C.lcd);
    for (const y of [8.6, 10.5, 12.4]) for (const x of [5.9, 7.6, 9.3]) rect(g, x, y, 1.1, 1, C.paperShade, false);
  },
};

const UI_PAINTERS: Record<string, Painter> = {
  camera: (g) => {
    rrect(g, 1.5, 4.5, 13, 9, 1.5, C.paperShade);
    rect(g, 5.5, 2.8, 4, 2.2, C.brassDark);
    circ(g, 8, 9, 3.2, C.slate);
    circ(g, 8, 9, 1.5, C.glass, false);
    circ(g, 12.4, 6.6, 0.6, C.brass, false);
  },
  close: (g) => {
    bar(g, [4, 4, 12, 12], C.paper, 2.2);
    bar(g, [12, 4, 4, 12], C.paper, 2.2);
  },
  lock: (g) => {
    g.beginPath();
    g.moveTo(4.8, 8);
    g.lineTo(4.8, 5.3);
    g.arc(8, 5.3, 3.2, Math.PI, 0);
    g.lineTo(11.2, 8);
    g.strokeStyle = C.ink;
    g.lineWidth = 4;
    g.stroke();
    g.strokeStyle = C.steel;
    g.lineWidth = 1.8;
    g.stroke();
    g.strokeStyle = C.ink;
    g.lineWidth = OUTLINE;
    rrect(g, 3, 7.5, 10, 7, 1.2, C.brass);
    circ(g, 8, 10.3, 1.1, C.ink, false);
    rect(g, 7.4, 10.5, 1.2, 2.3, C.ink, false);
  },
  truck: (g) => {
    rect(g, 1.5, 4, 9, 7.5, C.paperShade);
    poly(g, [10.5, 6, 13, 6, 14.5, 8.5, 14.5, 11.5, 10.5, 11.5], C.brass);
    poly(g, [11.3, 6.9, 12.6, 6.9, 13.6, 8.7, 11.3, 8.7], C.glass, false);
    wheel(g, 4.5, 12.3, 1.9);
    wheel(g, 12, 12.3, 1.9);
  },
  train: (g) => {
    rect(g, 3, 2.5, 2.4, 4, C.slate);
    rect(g, 1.5, 6, 9, 5, C.slate);
    rect(g, 6.3, 6, 1.4, 5, C.brass, false);
    rect(g, 10, 3, 4.5, 8, C.red);
    rect(g, 11, 4.2, 2.5, 2.4, C.glass, false);
    rect(g, 1, 11, 14, 1.2, C.ink, false);
    wheel(g, 3.8, 13.2, 1.7);
    wheel(g, 7.8, 13.2, 1.7);
    wheel(g, 12, 13.2, 1.7);
  },
  money: (g) => {
    for (let k = 0; k < 3; k++) {
      const y = 11 - 3 * k;
      g.beginPath();
      g.moveTo(2.5, y);
      g.lineTo(2.5, y + 2);
      g.ellipse(8, y + 2, 5.5, 2, 0, Math.PI, 0, true);
      g.lineTo(13.5, y);
      g.closePath();
      fs(g, C.brass);
      ell(g, 8, y, 5.5, 2, C.brassLight);
    }
    ell(g, 8, 5, 2.4, 0.8, C.brass, 0, false);
  },
  warning: (g) => {
    poly(g, [8, 1.5, 15, 14, 1, 14], C.brassLight);
    rect(g, 7.2, 5.3, 1.6, 4.9, C.ink, false);
    circ(g, 8, 11.9, 1, C.ink, false);
  },
  // toast tones (ui/toasts.ts): a disc in the tone with a white mark
  info: (g) => {
    circ(g, 8, 8, 6.8, C.blue);
    circ(g, 8, 4.9, 1.1, C.paper, false);
    rect(g, 7.1, 7, 1.8, 5.2, C.paper, false);
  },
  positive: (g) => {
    circ(g, 8, 8, 6.8, C.green);
    line(g, [4.8, 8.2, 7.1, 10.6, 11.4, 5.6], C.paper, 2);
  },
  negative: (g) => {
    circ(g, 8, 8, 6.8, C.red);
    line(g, [5.4, 5.4, 10.6, 10.6], C.paper, 2);
    line(g, [10.6, 5.4, 5.4, 10.6], C.paper, 2);
  },
  star: (g) => {
    const pts: number[] = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 === 0 ? 7 : 2.9;
      pts.push(8 + Math.cos(a) * r, 8.6 + Math.sin(a) * r);
    }
    poly(g, pts, C.brassLight);
  },
  route: (g) => {
    g.beginPath();
    g.moveTo(3.5, 12.5);
    g.bezierCurveTo(3.5, 5, 12.5, 11, 12.5, 3.5);
    g.strokeStyle = C.ink;
    g.lineWidth = 3.4;
    g.stroke();
    g.strokeStyle = C.paperShade;
    g.lineWidth = 1.4;
    g.setLineDash([2, 1.5]);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = C.ink;
    g.lineWidth = OUTLINE;
    circ(g, 3.5, 12.5, 2.3, C.green);
    circ(g, 12.5, 3.5, 2.3, C.red);
  },
  factory: (g) => {
    rect(g, 11.5, 1.5, 2.6, 13, C.slate);
    poly(g, [1.5, 14.5, 1.5, 8, 5, 5.5, 5, 8, 8.5, 5.5, 8.5, 8, 12, 5.5, 12, 14.5], C.red);
    for (const x of [3, 6.5]) rect(g, x, 10, 2, 2.2, C.brassLight, false);
    rect(g, 10, 10, 1.5, 2.2, C.brassLight, false);
  },
  city: (g) => {
    rect(g, 1.5, 7, 4.5, 7.5, C.paperShade);
    rect(g, 10, 5, 4.5, 9.5, C.paperShade);
    poly(g, [5.5, 2.5, 8, 0.8, 10.5, 2.5, 10.5, 14.5, 5.5, 14.5], C.paper);
    for (const [x, y] of [[2.8, 9], [2.8, 11.6], [7, 4.5], [7, 7.5], [7, 10.5], [11.3, 7], [11.3, 10]]) {
      rect(g, x, y, 1.8, 1.6, C.brassDark, false);
    }
  },
  news: (g) => {
    rect(g, 2, 2.5, 12, 11.5, C.paper);
    rect(g, 3.5, 4, 9, 2, C.ink, false);
    for (const y of [8, 10, 12]) line(g, [3.6, y, 7.4, y], C.slate, 1);
    rect(g, 9, 7.5, 3.5, 5, C.paperShade);
  },
  smog: (g) => {
    g.lineWidth = OUTLINE * 2;
    g.beginPath();
    g.rect(4, 9.5, 8, 4);
    g.stroke();
    g.lineWidth = OUTLINE;
    blob(g, [[4.5, 10, 3.2], [8.5, 7, 4], [12, 10, 3]], C.smoke);
    rect(g, 4.5, 9.5, 7.5, 3.9, C.smoke, false);
    line(g, [5.5, 9.8, 8, 8.2], C.paperShade, 1);
  },
  // a conifer on a trunk: the tree-planting tool
  tree: (g) => {
    rect(g, 7, 11.5, 2, 3.5, C.walnut);
    poly(g, [8, 1.5, 13, 8, 3, 8], C.green);
    poly(g, [8, 4.5, 14, 12, 2, 12], C.green);
    line(g, [8, 6, 10.5, 9.5], C.paperShade, 0.8);
  },
  // a chimney capped by a filter box, a thin wisp above: smoke scrubbers
  scrubber: (g) => {
    rect(g, 6, 8, 4, 7, C.red);
    rect(g, 4, 5, 8, 3.5, C.steel);
    line(g, [5, 6.7, 11, 6.7], C.slate, 0.8);
    blob(g, [[8.5, 2.8, 1.6]], C.paperShade);
  },
  // weather vane arrow, pointing east (the HUD rotates it to the wind)
  wind: (g) => {
    // fletching: two pairs of feathers swept back from the shaft
    for (const x of [1.4, 4.4]) {
      bar(g, [x, 4.2, x + 2.6, 8], C.brass, 1.4);
      bar(g, [x, 11.8, x + 2.6, 8], C.brass, 1.4);
    }
    bar(g, [1.6, 8, 10, 8], C.brassLight, 2);
    poly(g, [8.5, 3.5, 15, 8, 8.5, 12.5], C.brassLight);
  },
  // raised red fist (smog protests: survey city labels at tier 3+)
  protest: (g) => {
    rect(g, 6, 9.5, 4.4, 5.5, C.red);
    rrect(g, 4, 3, 8.4, 7.2, 1.6, C.red);
    // knuckle creases and the thumb across them
    line(g, [6.1, 3.4, 6.1, 6.2], C.ink, 0.8);
    line(g, [8.2, 3.4, 8.2, 6.2], C.ink, 0.8);
    line(g, [10.3, 3.4, 10.3, 6.2], C.ink, 0.8);
    rrect(g, 3.2, 6.4, 6.6, 2.6, 1.2, C.red);
  },
  // picket placard on its stick (strikes: survey building symbols, sim/society/strikes.ts)
  strike: (g) => {
    bar(g, [8, 8.5, 8, 15], C.walnut, 1.8);
    rect(g, 2, 1.5, 12, 7.5, C.paper);
    rect(g, 3.6, 4.1, 8.8, 2.3, C.red, false);
  },
  rain: (g) => {
    for (const x of [4.6, 8.2, 11.8]) bar(g, [x, 11, x - 1.2, 14.6], C.glass, 1.4);
    blob(g, [[4.8, 7, 3], [8.4, 4.8, 3.7], [11.6, 7.2, 2.9]], C.paperShade);
    rect(g, 4.6, 6.6, 7.4, 3.4, C.paperShade, false);
  },
  play: (g) => poly(g, [4.5, 2.5, 13, 8, 4.5, 13.5], C.brassLight),
  pause: (g) => {
    rect(g, 3.5, 2.5, 3.2, 11, C.brassLight);
    rect(g, 9.3, 2.5, 3.2, 11, C.brassLight);
  },
  // map badge for a building being upgraded: scaffold frame with a cross brace
  scaffold: (g) => {
    bar(g, [3.5, 14.5, 3.5, 2], C.walnut, 1.6);
    bar(g, [12.5, 14.5, 12.5, 2], C.walnut, 1.6);
    bar(g, [3.5, 5, 12.5, 5], C.brassLight, 1.6);
    bar(g, [3.5, 10, 12.5, 10], C.brassLight, 1.6);
    bar(g, [3.5, 10, 12.5, 5], C.walnut, 1.2);
  },
  fast: (g) => {
    poly(g, [1.5, 3, 8, 8, 1.5, 13], C.brassLight);
    poly(g, [8, 3, 14.5, 8, 8, 13], C.brassLight);
  },
  // HUD: the More menu (three brass studs) and Help (the brass "?" disc unknown ids fall back to)
  more: (g) => {
    for (const x of [3, 8, 13]) circ(g, x, 8, 1.9, C.brassLight);
  },
  help: (g) => unknown(g),
  // building categories (route stop rows) and decorative glyphs
  gear: (g) => {
    const pts: number[] = [];
    for (let i = 0; i < 32; i++) {
      const a = (i * TAU) / 32 + TAU / 64;
      const r = i % 4 < 2 ? 7 : 5.2;
      pts.push(8 + Math.cos(a) * r, 8 + Math.sin(a) * r);
    }
    poly(g, pts, C.brass);
    circ(g, 8, 8, 2.1, C.walnut);
  },
  pick: (g) => {
    g.save();
    g.translate(8, 8);
    g.rotate(Math.PI / 4);
    bar(g, [0, -4, 0, 7], C.brassDark, 2.2);
    g.beginPath();
    g.moveTo(-6.5, -2);
    g.quadraticCurveTo(0, -7.5, 6.5, -2);
    g.strokeStyle = C.ink;
    g.lineWidth = 4.6;
    g.stroke();
    g.strokeStyle = C.steel;
    g.lineWidth = 2.4;
    g.stroke();
    g.strokeStyle = C.ink;
    g.lineWidth = OUTLINE;
    g.restore();
  },
  shop: (g) => {
    rect(g, 2.5, 6.5, 11, 8, C.paperShade);
    rect(g, 6.5, 9.5, 3, 5, C.brassDark);
    rect(g, 1.5, 3, 13, 3.5, C.red);
    rect(g, 4.1, 3, 2.6, 3.5, C.paper, false);
    rect(g, 9.3, 3, 2.6, 3.5, C.paper, false);
    g.beginPath();
    g.rect(1.5, 3, 13, 3.5);
    g.stroke();
  },
  ballot: (g) => {
    rect(g, 2, 8, 12, 6.5, C.walnut);
    rect(g, 5, 8, 6, 1.2, C.ink, false);
    poly(g, [5, 1.5, 11.5, 1.5, 11.5, 8.6, 5, 8.6], C.paper);
    line(g, [6.6, 4.8, 8, 6.4, 10.4, 3], C.red, 1.3);
    rect(g, 6.5, 11, 3, 1.2, C.brass, false);
  },
  crate: (g) => {
    rect(g, 2, 3, 12, 11, C.brass);
    rect(g, 4, 5, 8, 7, C.brass);
    line(g, [4, 12, 12, 5], C.ink, OUTLINE);
  },
  // mayor edicts (city panel)
  permit: (g) => {
    poly(g, [3, 1.5, 10.5, 1.5, 13, 4, 13, 14.5, 3, 14.5], C.paper);
    for (const [x1, y] of [[11, 5.5], [11, 7.5], [8, 9.5]]) line(g, [5, y, x1, y], C.slate, 1);
    circ(g, 10.3, 11.6, 2.4, C.red);
    line(g, [9.2, 11.6, 10.1, 12.5, 11.5, 10.7], C.paper, 0.9);
  },
  toll: (g) => {
    rect(g, 2, 4, 2.6, 10.5, C.slate);
    g.beginPath();
    g.rect(3.3, 6, 11.2, 2.6);
    fs(g, C.paper);
    for (const x of [5.6, 9.6]) rect(g, x, 6, 2, 2.6, C.red, false);
    g.beginPath();
    g.rect(3.3, 6, 11.2, 2.6);
    g.stroke();
    circ(g, 3.3, 7.3, 1.3, C.brass);
    rect(g, 1, 13.5, 5, 1.4, C.coal);
  },
  manager: (g) => {
    circ(g, 8, 4.8, 2.7, C.paperShade);
    poly(g, [2.5, 14.5, 3.5, 9.5, 12.5, 9.5, 13.5, 14.5], C.slate);
    poly(g, [7, 9.5, 8, 11, 9, 9.5], C.paper);
    line(g, [8, 11, 8, 14], C.red, 1.2);
    rect(g, 5, 1.8, 6, 1.6, C.coal);
  },
  // a warehouse hub: a depot with spokes to three stops
  hub: (g) => {
    for (const [x, y] of [[2.5, 3], [13.5, 3], [8, 14]]) line(g, [8, 8.5, x, y], C.brassDark, 1.2);
    for (const [x, y] of [[2.5, 3], [13.5, 3], [8, 14]]) circ(g, x, y, 1.7, C.paper);
    poly(g, [4.5, 8, 8, 5, 11.5, 8, 11.5, 11.5, 4.5, 11.5], C.brass);
    rect(g, 7, 9, 2, 2.5, C.walnut);
  },
  wage: (g) => {
    rect(g, 1.5, 5, 13, 9, C.paperShade);
    poly(g, [1.5, 5, 8, 10, 14.5, 5], C.paper);
    circ(g, 11.5, 4.5, 3, C.brassLight);
    line(g, [11.5, 3, 11.5, 6], C.brassDark, 1.1);
  },
};

const ACHIEVEMENT_PAINTERS: Record<string, Painter> = {
  bell: (g) => {
    rect(g, 7.3, 3.5, 1.4, 2.5, C.brassDark);
    circ(g, 8, 3.4, 1.3, C.brassLight);
    g.beginPath();
    g.arc(8, 12, 5.5, Math.PI, 0);
    g.closePath();
    fs(g, C.brassLight);
    rect(g, 1.5, 12, 13, 2.2, C.brassDark);
    line(g, [4.5, 10.5, 5.5, 8.5], C.paper, 1);
  },
  chain: (g) => {
    for (const [x, y] of [[5.4, 10.6], [10.6, 5.4]]) {
      g.beginPath();
      g.ellipse(x, y, 4, 2.3, -Math.PI / 4, 0, TAU);
      g.strokeStyle = C.ink;
      g.lineWidth = 4.4;
      g.stroke();
      g.strokeStyle = C.steel;
      g.lineWidth = 2.1;
      g.stroke();
    }
    g.strokeStyle = C.ink;
    g.lineWidth = OUTLINE;
  },
  soap: (g) => {
    rrect(g, 2, 8.5, 12, 6, 2, C.glass);
    line(g, [4, 10.5, 9, 10.5], C.paper, 1);
    circ(g, 5, 5, 2.1, C.paper);
    circ(g, 9.8, 3.4, 1.5, C.paper);
    circ(g, 12.2, 6.5, 1.2, C.paper);
  },
  scroll: (g) => {
    rect(g, 3.5, 3, 9, 10, C.paper);
    rrect(g, 2, 1.5, 12, 2.6, 1.3, C.paperShade);
    rrect(g, 2, 12, 12, 2.6, 1.3, C.paperShade);
    for (const [x0, x1, y] of [[5, 11, 6], [5, 11, 8], [5, 8.5, 10]]) line(g, [x0, y, x1, y], C.slate, 1);
    circ(g, 10.6, 10.3, 1.4, C.red);
  },
  chart_down: (g) => {
    rect(g, 1.5, 1.5, 13, 13, C.paper);
    line(g, [3.5, 3, 3.5, 12.5, 13, 12.5], C.ink, 1);
    line(g, [4.5, 4.5, 7, 7.5, 9, 6.3, 12, 10.5], C.red, 1.8);
    poly(g, [10.3, 10.8, 12.8, 11.5, 12.5, 8.9], C.red, false);
  },
  top_hat: (g) => {
    ell(g, 8, 12.8, 7, 1.9, C.hat);
    g.beginPath();
    g.moveTo(4, 12.6);
    g.lineTo(4.5, 2.5);
    g.lineTo(11.5, 2.5);
    g.lineTo(12, 12.6);
    g.closePath();
    fs(g, C.hat);
    rect(g, 4.15, 9, 7.7, 2, C.red, false);
    line(g, [5.8, 3.8, 5.6, 8], C.steel, 1);
  },
  fireworks: (g) => {
    for (let i = 0; i < 8; i++) {
      const a = (i * TAU) / 8;
      const c = i % 2 === 0 ? C.brassLight : C.red;
      bar(g, [8 + Math.cos(a) * 2.2, 8 + Math.sin(a) * 2.2, 8 + Math.cos(a) * 6.5, 8 + Math.sin(a) * 6.5], c, 1.3);
    }
    circ(g, 8, 8, 1.6, C.paper);
  },
  crown: (g) => {
    poly(g, [2, 13, 2, 5, 5.2, 8.5, 8, 3, 10.8, 8.5, 14, 5, 14, 13], C.brassLight);
    rect(g, 2, 10.8, 12, 2.4, C.brass);
    circ(g, 8, 12, 0.9, C.red, false);
    for (const [x, y] of [[2, 4.4], [8, 2.4], [14, 4.4]]) circ(g, x, y, 1, C.brassLight);
  },
};

/** City landmarks (data/landmarks.ts ids): small civic silhouettes. */
const LANDMARK_ICON_PAINTERS: Record<string, Painter> = {
  church: (g) => {
    rect(g, 2, 8, 8, 6, C.paperShade);
    poly(g, [1.5, 8.5, 6, 5, 10.5, 8.5], C.slate);
    rect(g, 9.5, 6, 4.5, 8, C.paperShade);
    poly(g, [9, 6.5, 11.75, 1, 14.5, 6.5], C.slate);
    line(g, [11.75, 1.2, 11.75, 0], C.brass, 1);
    rect(g, 10.8, 10.5, 1.9, 3.5, C.walnut, false);
    circ(g, 5, 10.5, 1, C.glass, false);
  },
  town_hall: (g) => {
    rect(g, 1.5, 8, 13, 6, C.red);
    rect(g, 6, 3.5, 4, 10.5, C.red);
    poly(g, [5.5, 4, 8, 1, 10.5, 4], C.slate);
    circ(g, 8, 6.3, 1.3, C.paper);
    rect(g, 1.5, 7.5, 13, 1.2, C.paper, false);
    for (const x of [3, 11.5]) rect(g, x, 10, 1.5, 2, C.brassLight, false);
    rect(g, 7.2, 11, 1.6, 3, C.walnut, false);
  },
  grand_station: (g) => {
    g.beginPath();
    g.moveTo(1.5, 14);
    g.lineTo(1.5, 8);
    g.arc(8, 8, 6.5, Math.PI, 0);
    g.lineTo(14.5, 14);
    g.closePath();
    fs(g, C.paperShade);
    g.beginPath();
    g.moveTo(4.5, 14);
    g.lineTo(4.5, 9);
    g.arc(8, 9, 3.5, Math.PI, 0);
    g.lineTo(11.5, 14);
    g.closePath();
    fs(g, C.glass);
    line(g, [8, 5.5, 8, 14], C.ink, 0.8);
    circ(g, 8, 3.4, 1.2, C.paper);
  },
  library: (g) => {
    g.beginPath();
    g.arc(8, 7, 4, Math.PI, 0);
    g.closePath();
    fs(g, C.green);
    rect(g, 7.4, 1.5, 1.2, 1.6, C.brass, false);
    poly(g, [1, 9, 8, 6.5, 15, 9], C.paper);
    rect(g, 2, 9, 12, 4, C.paperShade);
    for (const x of [3.5, 6, 8.8, 11.4]) rect(g, x, 9.5, 1.1, 3, C.slate, false);
    rect(g, 1, 13, 14, 1.6, C.paper);
  },
  stadium: (g) => {
    ell(g, 8, 8, 7, 6.5, C.red);
    ell(g, 8, 8, 4.6, 4.1, C.green);
    line(g, [8, 4.2, 8, 11.8], C.paper, 0.8);
    circ(g, 8, 8, 1.2, C.green, false);
    g.beginPath();
    g.arc(8, 8, 1.2, 0, TAU);
    g.strokeStyle = C.paper;
    g.lineWidth = 0.7;
    g.stroke();
    g.strokeStyle = C.ink;
    g.lineWidth = OUTLINE;
  },
  skyscraper: (g) => {
    rect(g, 3, 9, 10, 6, C.steel);
    rect(g, 5, 4.5, 6, 10.5, C.steel);
    rect(g, 6.5, 2, 3, 3, C.paperShade);
    line(g, [8, 2, 8, 0.2], C.ink, 1);
    for (const y of [6, 8.5, 11]) {
      rect(g, 6.2, y, 1.2, 1.3, C.brassLight, false);
      rect(g, 8.6, y, 1.2, 1.3, C.brassLight, false);
    }
    for (const x of [4, 11.2]) rect(g, x, 11, 0.9, 1.3, C.brassLight, false);
  },
  park: (g) => {
    rect(g, 1, 12, 14, 2.5, C.green);
    line(g, [8, 12, 8, 14.5], C.paperShade, 1.6);
    rect(g, 3.6, 8.5, 1.4, 4, C.walnut, false);
    blob(g, [[4.3, 6.5, 3], [6.2, 4.6, 2.2]], C.green);
    rect(g, 11.2, 9, 1.4, 3.5, C.walnut, false);
    blob(g, [[11.9, 7, 2.6]], C.green);
    poly(g, [8, 4.5, 10, 6, 6, 6], C.brass);
  },
  hospital: (g) => {
    rect(g, 1.5, 6, 13, 8.5, C.paper);
    poly(g, [1, 6.5, 8, 2, 15, 6.5], C.slate);
    rect(g, 6.5, 6.8, 3, 7.4, C.red, false);
    rect(g, 4.6, 8.7, 6.8, 3, C.red, false);
    for (const x of [2.6, 12.2]) rect(g, x, 8.5, 1.3, 2, C.glass, false);
  },
};

/** One painter per id. Append new glyphs here. */
const PAINTERS: Record<IconId, Painter> = { ...GOOD_PAINTERS, ...UI_PAINTERS, ...ACHIEVEMENT_PAINTERS, ...LANDMARK_ICON_PAINTERS };

export const ICON_IDS: readonly IconId[] = Object.freeze(Object.keys(PAINTERS));

/** Brass disc with an ink "?" for ids nobody painted. */
function unknown(g: Ctx): void {
  circ(g, 8, 8, 6.5, C.brass);
  g.beginPath();
  g.arc(8, 6.2, 2.3, Math.PI, Math.PI * 2.4);
  g.lineTo(8, 9.6);
  g.lineWidth = 1.8;
  g.stroke();
  g.lineWidth = OUTLINE;
  circ(g, 8, 12, 1, C.ink, false);
}

/** Paint icon `id` into the `size`×`size` box with its top-left corner at (x, y). */
export function drawIcon(g: Ctx, id: IconId, x: number, y: number, size: number): void {
  g.save();
  g.translate(x, y);
  g.scale(size / 16, size / 16);
  g.strokeStyle = C.ink;
  g.lineWidth = OUTLINE;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  (PAINTERS[id] ?? unknown)(g);
  g.restore();
}

const urlCache = new Map<string, string>();

/** PNG data URL of icon `id` at `size` CSS px (rendered at device resolution), cached per id@size and render scale. '' without a canvas (jsdom). */
export function iconDataUrl(id: IconId, size: number): string {
  // jsdom has no canvas; sniff it first to avoid its "not implemented" console noise
  if (typeof document === 'undefined' || /jsdom/i.test(globalThis.navigator?.userAgent ?? '')) return '';
  const scale = Math.max(1, Math.min(3, Math.ceil(globalThis.devicePixelRatio || 1)));
  const key = `${id}@${size}x${scale}`; // scale in the key: a DPR change re-renders
  const hit = urlCache.get(key);
  if (hit !== undefined) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size * scale;
  const g = canvas.getContext('2d');
  if (!g) return '';
  drawIcon(g, id, 0, 0, size * scale);
  const url = canvas.toDataURL('image/png');
  urlCache.set(key, url);
  return url;
}
