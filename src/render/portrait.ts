/**
 * Procedural portraits of the Smogsworths, drawn into the square (0, 0, size, size) of `ctx`; no
 * image assets.
 *
 * Generation 1, Baron Cornelius: top hat, monocle on a gold chain, grey mutton chops, a waxed
 * handlebar moustache and a frock coat with a cravat. Generation 2, Junior: a homburg, slicked dark
 * hair, a pencil moustache, no chops, a smooth young face and a pinstripe suit with a tie (he keeps
 * his father's monocle).
 *
 * Moods: `smug` sneers with one eyebrow cocked; `furious` scowls, red-faced, teeth bared; `scheming`
 * narrows his eyes, glances aside and steeples his fingers against a plum backdrop; `gloating` grins
 * with his eyes screwed shut and a fat cigar, against a gilded backdrop.
 */
import { BARON_MOODS, type BaronMood } from '../sim/nemesis/types';

export { BARON_MOODS, type BaronMood };

interface Look {
  mood: BaronMood;
  junior: boolean;
}

const BACKDROP: Record<BaronMood, string> = {
  smug: '#a8423a',
  furious: '#c8463a',
  scheming: '#5e3a66',
  gloating: '#b88a2e',
};
const BACKDROP_EDGE: Record<BaronMood, string> = {
  smug: '#3a1210',
  furious: '#3a1210',
  scheming: '#1c1024',
  gloating: '#3a2410',
};
/** how far each mood tilts the hat (radians) */
const HAT_TILT: Record<BaronMood, number> = { smug: -0.08, furious: 0.04, scheming: 0.1, gloating: -0.16 };

export function drawBaronPortrait(ctx: CanvasRenderingContext2D, size: number, mood: BaronMood, generation: 1 | 2 = 1): void {
  const look: Look = { mood, junior: generation === 2 };
  ctx.save();
  ctx.scale(size / 100, size / 100);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // --- backdrop: an oval cameo with a vignette, coloured by mood
  const bg = ctx.createRadialGradient(50, 45, 8, 50, 50, 62);
  bg.addColorStop(0, BACKDROP[mood]);
  bg.addColorStop(1, BACKDROP_EDGE[mood]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 100, 100);
  ctx.strokeStyle = '#c9a227';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(50, 52, 46, 47, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(50, 52, 45, 46, 0, 0, Math.PI * 2);
  ctx.clip();

  drawClothes(ctx, look);
  drawHead(ctx, look);
  drawEyes(ctx, look);
  drawMonocle(ctx, look);
  drawMoustache(ctx, look);
  drawMouth(ctx, look);
  if (look.junior) drawHomburg(ctx, mood);
  else drawTopHat(ctx, mood);
  if (mood === 'scheming') drawSteepledHands(ctx, look);

  ctx.restore(); // clip

  // gilt nameplate
  ctx.fillStyle = '#c9a227';
  ctx.fillRect(28, 92, 44, 6);
  ctx.fillStyle = '#2b1d14';
  ctx.font = `bold ${look.junior ? 3.8 : 4.2}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(look.junior ? 'SMOGSWORTH JR.' : 'SMOGSWORTH', 50, 95.2);

  ctx.restore();
}

/** Frock coat and cravat (the Baron), or a pinstripe suit and tie (Junior). */
function drawClothes(ctx: CanvasRenderingContext2D, { junior }: Look): void {
  ctx.fillStyle = junior ? '#2c3139' : '#1b1716';
  ctx.beginPath();
  ctx.moveTo(8, 100);
  ctx.quadraticCurveTo(14, 76, 34, 72);
  ctx.lineTo(66, 72);
  ctx.quadraticCurveTo(86, 76, 92, 100);
  ctx.closePath();
  ctx.fill();
  if (junior) {
    ctx.strokeStyle = 'rgba(210,215,225,0.22)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let x = 14; x <= 86; x += 4) {
      if (x > 37 && x < 63) continue;
      ctx.moveTo(x, 78);
      ctx.lineTo(x + (x < 50 ? -2 : 2), 100);
    }
    ctx.stroke();
  }
  ctx.fillStyle = '#f2ece0'; // shirt
  ctx.beginPath();
  ctx.moveTo(38, 72);
  ctx.lineTo(50, 90);
  ctx.lineTo(62, 72);
  ctx.closePath();
  ctx.fill();
  if (junior) {
    // a narrow striped tie with a tight knot
    ctx.fillStyle = '#8f2a26';
    ctx.beginPath();
    ctx.moveTo(47.5, 74);
    ctx.lineTo(52.5, 74);
    ctx.lineTo(51.5, 78);
    ctx.lineTo(53.5, 94);
    ctx.lineTo(50, 98);
    ctx.lineTo(46.5, 94);
    ctx.lineTo(48.5, 78);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#d9b44a';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let y = 81; y < 95; y += 3.5) {
      ctx.moveTo(48, y + 1.5);
      ctx.lineTo(52.5, y);
    }
    ctx.stroke();
  } else {
    ctx.fillStyle = '#7a1c1a'; // cravat
    ctx.beginPath();
    ctx.moveTo(44, 75);
    ctx.lineTo(50, 80);
    ctx.lineTo(56, 75);
    ctx.lineTo(53, 92);
    ctx.lineTo(47, 92);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e8c75a'; // cravat pin
    ctx.beginPath();
    ctx.arc(50, 81, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // lapels
  ctx.strokeStyle = junior ? '#545b66' : '#3a302c';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(36, 73);
  ctx.lineTo(44, 98);
  ctx.moveTo(64, 73);
  ctx.lineTo(56, 98);
  ctx.stroke();
  if (junior) {
    // a white pocket square
    ctx.fillStyle = '#f2ece0';
    ctx.beginPath();
    ctx.moveTo(66, 84);
    ctx.lineTo(68, 81);
    ctx.lineTo(70, 83.5);
    ctx.lineTo(72, 81.5);
    ctx.lineTo(73, 84.5);
    ctx.closePath();
    ctx.fill();
  }
}

/** Face, ears, cheeks, hair (the Baron's chops or Junior's slicked sides) and nose. */
function drawHead(ctx: CanvasRenderingContext2D, { mood, junior }: Look): void {
  const furious = mood === 'furious';
  const skin = furious ? (junior ? '#eda68a' : '#e79a80') : junior ? '#f0c6a2' : '#e9b996';
  ctx.fillStyle = skin;
  ctx.beginPath();
  if (junior) {
    // a leaner face tapering to a firm chin
    ctx.moveTo(50, 31);
    ctx.bezierCurveTo(61, 31, 66, 40, 65.5, 52);
    ctx.bezierCurveTo(65, 64, 58, 72.5, 50, 72.5);
    ctx.bezierCurveTo(42, 72.5, 35, 64, 34.5, 52);
    ctx.bezierCurveTo(34, 40, 39, 31, 50, 31);
  } else {
    ctx.ellipse(50, 52, 17, 21, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  // ears
  ctx.beginPath();
  ctx.ellipse(junior ? 34 : 33, 52, 3, 5, 0, 0, Math.PI * 2);
  ctx.ellipse(junior ? 66 : 67, 52, 3, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  // cheeks: ruddy on the old man, a faint flush on the young one
  ctx.fillStyle = furious ? 'rgba(200,30,30,0.45)' : junior ? 'rgba(210,100,90,0.14)' : 'rgba(200,80,70,0.25)';
  ctx.beginPath();
  ctx.ellipse(40, 58, 5, 3.5, 0, 0, Math.PI * 2);
  ctx.ellipse(60, 58, 5, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();

  if (junior) {
    // slicked, near-black hair showing under the hat at the temples, cut short above the ears
    ctx.fillStyle = '#211a16';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(50 + side * 9, 33);
      ctx.quadraticCurveTo(50 + side * 15.5, 34, 50 + side * 16, 47);
      ctx.lineTo(50 + side * 14.5, 47);
      ctx.quadraticCurveTo(50 + side * 13.5, 38, 50 + side * 7, 35.5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; // brilliantine sheen
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(38, 35.5);
    ctx.quadraticCurveTo(36, 38, 35.6, 42);
    ctx.moveTo(62, 35.5);
    ctx.quadraticCurveTo(64, 38, 64.4, 42);
    ctx.stroke();
  } else {
    // mutton chops: bushy grey-brown sideburns sweeping into the cheeks
    ctx.fillStyle = '#6e6259';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(50 + side * 16, 38);
      ctx.quadraticCurveTo(50 + side * 21, 56, 50 + side * 15, 70);
      ctx.quadraticCurveTo(50 + side * 9, 68, 50 + side * 8, 60);
      ctx.quadraticCurveTo(50 + side * 12, 52, 50 + side * 13, 40);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = '#857769';
    ctx.lineWidth = 0.7;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(50 + side * (14 + (i % 2)), 44 + i * 5);
        ctx.lineTo(50 + side * (11 + (i % 3)), 48 + i * 5);
        ctx.stroke();
      }
    }
  }

  // nose: a bulbous one for the Baron, a straight narrow one for Junior
  ctx.fillStyle = furious ? '#d77a63' : junior ? '#e0ad8c' : '#dba383';
  ctx.beginPath();
  if (junior) {
    ctx.moveTo(50, 48);
    ctx.lineTo(52.5, 57.5);
    ctx.quadraticCurveTo(50, 59, 47.5, 57.5);
  } else {
    ctx.moveTo(50, 48);
    ctx.quadraticCurveTo(54, 57, 52, 59);
    ctx.quadraticCurveTo(49, 60, 47, 58);
  }
  ctx.closePath();
  ctx.fill();
  if (!junior) {
    // jowly chin line
    ctx.strokeStyle = 'rgba(120,70,50,0.35)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(50, 64, 9, Math.PI * 0.25, Math.PI * 0.75);
    ctx.stroke();
  } else {
    // a cleft in the chin
    ctx.strokeStyle = 'rgba(150,90,60,0.35)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(50, 69.5);
    ctx.lineTo(50, 71.5);
    ctx.stroke();
  }
}

/** Eyes and brows for the mood. */
function drawEyes(ctx: CanvasRenderingContext2D, { mood, junior }: Look): void {
  const brow = junior ? '#231b17' : '#4e443d';
  ctx.fillStyle = '#1d1a16';
  ctx.strokeStyle = '#1d1a16';
  if (mood === 'gloating') {
    // eyes screwed shut in delight: two upturned arcs
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(43, 50.5, 2.4, Math.PI * 1.1, Math.PI * 1.9);
    ctx.moveTo(54.6, 49.6);
    ctx.arc(57, 50.5, 2.4, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  } else if (mood === 'scheming') {
    // narrowed slits under heavy lids, glancing to his left
    ctx.beginPath();
    ctx.ellipse(43, 49.4, 2, 0.75, 0, 0, Math.PI * 2);
    ctx.ellipse(57, 49.4, 2, 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8dccb';
    ctx.beginPath();
    ctx.ellipse(44.2, 49.4, 0.7, 0.45, 0, 0, Math.PI * 2);
    ctx.ellipse(58.2, 49.4, 0.7, 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,50,40,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40.5, 48.2);
    ctx.lineTo(45.5, 48.4);
    ctx.moveTo(54.5, 48.4);
    ctx.lineTo(59.5, 48.2);
    ctx.stroke();
  } else {
    const furious = mood === 'furious';
    ctx.beginPath();
    ctx.ellipse(43, 49, 1.6, furious ? 1.2 : 1.0, 0, 0, Math.PI * 2);
    ctx.ellipse(57, 49, 1.6, furious ? 1.4 : 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = brow;
  ctx.lineWidth = junior ? 1.8 : 2.2;
  ctx.beginPath();
  switch (mood) {
    case 'furious': // a deep V scowl
      ctx.moveTo(37, 42);
      ctx.lineTo(48, 46);
      ctx.moveTo(63, 42);
      ctx.lineTo(52, 46);
      break;
    case 'scheming': // both brows low and drawn in, the outer ends lifted: sly
      ctx.moveTo(37, 44);
      ctx.quadraticCurveTo(42, 45.5, 47.5, 46.5);
      ctx.moveTo(63, 43.5);
      ctx.quadraticCurveTo(58, 45, 52.5, 46.5);
      break;
    case 'gloating': // both brows high and arched
      ctx.moveTo(37, 44);
      ctx.quadraticCurveTo(42, 39.5, 47, 42.5);
      ctx.moveTo(53, 42.5);
      ctx.quadraticCurveTo(58, 39.5, 63, 44);
      break;
    default: // smug: left brow lowered, right brow cocked above the monocle
      ctx.moveTo(37, 45);
      ctx.lineTo(47, 46);
      ctx.moveTo(52, 42);
      ctx.quadraticCurveTo(57, 39, 63, 42);
  }
  ctx.stroke();
  if (mood === 'furious') {
    // throbbing temple vein
    ctx.strokeStyle = '#a3302a';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(60, 36);
    ctx.lineTo(62, 38);
    ctx.lineTo(60, 40);
    ctx.stroke();
  }
}

/** The family monocle over the right eye, its chain to the lapel. */
function drawMonocle(ctx: CanvasRenderingContext2D, { mood }: Look): void {
  const y = mood === 'gloating' ? 50 : 49;
  ctx.strokeStyle = '#e8c75a';
  ctx.lineWidth = 1.4;
  ctx.fillStyle = 'rgba(220,235,255,0.28)';
  ctx.beginPath();
  ctx.arc(57, y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.arc(55.3, y - 1.8, 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c9a227';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([1.2, 1]);
  ctx.beginPath();
  ctx.moveTo(61.5, y + 2);
  ctx.bezierCurveTo(70, 62, 66, 74, 61, 82);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** The Baron's waxed handlebar, or Junior's pencil moustache. */
function drawMoustache(ctx: CanvasRenderingContext2D, { mood, junior }: Look): void {
  // how the tips sit: drooping in fury, raised in glee
  const tip = mood === 'furious' ? 66 : mood === 'gloating' ? 54.5 : mood === 'scheming' ? 59 : 57;
  if (junior) {
    const end = mood === 'furious' ? 63 : mood === 'gloating' ? 60.2 : 61.4;
    ctx.strokeStyle = '#1e1714';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(49.2, 60.6);
    ctx.quadraticCurveTo(46, 60.4, 43.5, end);
    ctx.moveTo(50.8, 60.6);
    ctx.quadraticCurveTo(54, 60.4, 56.5, end);
    ctx.stroke();
    return;
  }
  ctx.fillStyle = '#5a4f48';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(50, 60);
    ctx.quadraticCurveTo(50 + side * 8, 58, 50 + side * 13, 62);
    ctx.quadraticCurveTo(50 + side * 17, 63, 50 + side * 17, tip);
    ctx.quadraticCurveTo(50 + side * 14, 65, 50 + side * 7, 63.5);
    ctx.quadraticCurveTo(50 + side * 2, 63, 50, 62.5);
    ctx.closePath();
    ctx.fill();
  }
}

/** The mouth for the mood; gloating adds a cigar. */
function drawMouth(ctx: CanvasRenderingContext2D, { mood, junior }: Look): void {
  const y = junior ? -1 : 0; // Junior's mouth sits a touch higher in his leaner face
  ctx.strokeStyle = '#6b2a24';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  switch (mood) {
    case 'furious':
      ctx.fillStyle = '#4a1a16';
      ctx.moveTo(44, 68 + y);
      ctx.quadraticCurveTo(50, 64.5 + y, 56, 68 + y);
      ctx.quadraticCurveTo(50, 66.8 + y, 44, 68 + y);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f4efe2';
      ctx.fillRect(46.5, 66.2 + y, 7, 1.1);
      break;
    case 'scheming':
      // lips pressed thin, one corner curling up
      ctx.lineWidth = 1.2;
      ctx.moveTo(45, 66.8 + y);
      ctx.quadraticCurveTo(50, 67.4 + y, 54.5, 66.4 + y);
      ctx.quadraticCurveTo(56, 65.8 + y, 56.6, 64.8 + y);
      ctx.stroke();
      break;
    case 'gloating': {
      // a wide open grin, teeth and a gold one showing
      ctx.fillStyle = '#4a1a16';
      ctx.moveTo(42.5, 64.5 + y);
      ctx.quadraticCurveTo(50, 66 + y, 57.5, 64.5 + y);
      ctx.quadraticCurveTo(50, 73.5 + y, 42.5, 64.5 + y);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f4efe2';
      ctx.beginPath();
      ctx.moveTo(44, 65.4 + y);
      ctx.quadraticCurveTo(50, 66.6 + y, 56, 65.4 + y);
      ctx.lineTo(55.5, 67 + y);
      ctx.quadraticCurveTo(50, 68 + y, 44.5, 67 + y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#e8c75a';
      ctx.fillRect(51.2, 65.9 + y, 1.6, 1.4);
      // a fat cigar from the corner of the grin, ember lit, smoke curling
      ctx.save();
      ctx.translate(57, 66 + y);
      ctx.rotate(-0.28);
      ctx.fillStyle = '#6b4126';
      ctx.fillRect(0, -1.4, 12, 2.8);
      ctx.fillStyle = '#c9a227';
      ctx.fillRect(2.2, -1.4, 1.6, 2.8);
      ctx.fillStyle = '#e8622a';
      ctx.fillRect(11.4, -1.4, 1.2, 2.8);
      ctx.restore();
      ctx.strokeStyle = 'rgba(235,230,220,0.55)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(69, 61.5 + y);
      ctx.bezierCurveTo(66, 57, 73, 54, 70, 49);
      ctx.bezierCurveTo(68, 46, 72, 43, 71, 40);
      ctx.stroke();
      break;
    }
    default:
      // a lopsided sneer
      ctx.moveTo(45, 66.5 + y);
      ctx.quadraticCurveTo(50, 67.5 + y, 54, 66 + y);
      ctx.quadraticCurveTo(56, 65 + y, 57, 63.5 + y);
      ctx.stroke();
  }
}

/** The Baron's silk top hat. */
function drawTopHat(ctx: CanvasRenderingContext2D, mood: BaronMood): void {
  ctx.save();
  ctx.translate(50, 32);
  ctx.rotate(HAT_TILT[mood]);
  ctx.fillStyle = '#121010';
  ctx.beginPath();
  ctx.ellipse(0, 1, 25, 4.5, 0, 0, Math.PI * 2); // brim
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-15, 0);
  ctx.lineTo(-16, -30);
  ctx.quadraticCurveTo(0, -33, 16, -30);
  ctx.lineTo(15, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#8f1f1d'; // band
  ctx.fillRect(-15.3, -6.5, 30.6, 5);
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; // silk sheen
  ctx.fillRect(-11, -29, 3, 22);
  ctx.restore();
}

/** Junior's homburg: a low, centre-dented crown and a curled brim, in charcoal felt. */
function drawHomburg(ctx: CanvasRenderingContext2D, mood: BaronMood): void {
  ctx.save();
  ctx.translate(50, 33);
  ctx.rotate(HAT_TILT[mood]);
  ctx.fillStyle = '#33373b';
  ctx.beginPath();
  ctx.moveTo(-15.5, 0);
  ctx.lineTo(-15, -13);
  ctx.quadraticCurveTo(-14, -18.5, -6, -18.5);
  ctx.quadraticCurveTo(0, -14.5, 6, -18.5);
  ctx.quadraticCurveTo(14, -18.5, 15, -13);
  ctx.lineTo(15.5, 0);
  ctx.closePath();
  ctx.fill();
  // the dent's shadow down the crown
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, -15.5);
  ctx.quadraticCurveTo(-0.6, -11, 0, -7);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.1)'; // felt sheen
  ctx.fillRect(-11, -14, 3, 8);
  // grosgrain band with a bow on the left
  ctx.fillStyle = '#121212';
  ctx.fillRect(-15.6, -5.5, 31.2, 4.5);
  ctx.beginPath();
  ctx.moveTo(-12, -3.2);
  ctx.lineTo(-8, -6);
  ctx.lineTo(-8, -0.4);
  ctx.closePath();
  ctx.fill();
  // brim, curled up at the sides, with a bound edge
  ctx.fillStyle = '#2a2e32';
  ctx.beginPath();
  ctx.moveTo(-23, -3);
  ctx.quadraticCurveTo(-21, 2.5, -12, 2.8);
  ctx.lineTo(12, 2.8);
  ctx.quadraticCurveTo(21, 2.5, 23, -3);
  ctx.quadraticCurveTo(21, -0.5, 14, -0.5);
  ctx.lineTo(-14, -0.5);
  ctx.quadraticCurveTo(-21, -0.5, -23, -3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#0e0e0e';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-23, -3);
  ctx.quadraticCurveTo(-21, 2.5, -12, 2.8);
  ctx.lineTo(12, 2.8);
  ctx.quadraticCurveTo(21, 2.5, 23, -3);
  ctx.stroke();
  ctx.restore();
}

/** Fingertips pressed together under the chin. */
function drawSteepledHands(ctx: CanvasRenderingContext2D, { junior }: Look): void {
  const skin = junior ? '#f0c6a2' : '#e9b996';
  for (const side of [-1, 1]) {
    // cuff
    ctx.fillStyle = '#f2ece0';
    ctx.beginPath();
    ctx.moveTo(50 + side * 6, 100);
    ctx.lineTo(50 + side * 15, 100);
    ctx.lineTo(50 + side * 13.5, 92);
    ctx.lineTo(50 + side * 6.5, 92);
    ctx.closePath();
    ctx.fill();
    // hand: palm rising to fingertips that meet at the centre
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.moveTo(50 + side * 6.5, 92.5);
    ctx.lineTo(50 + side * 13.5, 92.5);
    ctx.quadraticCurveTo(50 + side * 12, 84, 50 + side * 0.6, 76);
    ctx.lineTo(50 + side * 0.6, 86);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,70,50,0.5)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let i = 1; i <= 3; i++) {
      ctx.moveTo(50 + side * (1 + i * 2.6), 92 - i * 0.6);
      ctx.lineTo(50 + side * 1, 77 + i * 2.4);
    }
    ctx.stroke();
  }
}

/** Initials of a company name for the crest's shield: "Hartley & Sons" gives "HS", one word gives its first letter. */
export function crestInitials(name: string): string {
  const words = name
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length > 0 && !/^(and|of|the|co|ltd|inc)$/i.test(w));
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

/**
 * Procedural family crest for the player's company, in the same cameo style as the Baron's portrait:
 * a quartered heater shield (cobalt and cream, the player's colours) with a brass chevron, a
 * smokestack and a cog, the company's initials on an inescutcheon, laurel sprays at the sides and the
 * company name on a ribbon scroll beneath. Drawn into the square (0, 0, size, size) of `ctx`.
 */
export function drawFamilyCrest(ctx: CanvasRenderingContext2D, size: number, name: string): void {
  ctx.save();
  ctx.scale(size / 100, size / 100);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // --- backdrop: a walnut cameo with a brass ring, like the Baron's
  const bg = ctx.createRadialGradient(50, 42, 8, 50, 50, 62);
  bg.addColorStop(0, '#4a6f9a');
  bg.addColorStop(1, '#14202e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 100, 100);
  ctx.strokeStyle = '#c9a227';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(50, 52, 46, 47, 0, 0, Math.PI * 2);
  ctx.stroke();

  // --- laurel sprays either side of the shield
  for (const side of [-1, 1]) {
    ctx.strokeStyle = '#7a8f3a';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(50 + side * 12, 84);
    ctx.quadraticCurveTo(50 + side * 36, 74, 50 + side * 34, 30);
    ctx.stroke();
    for (let i = 0; i < 7; i++) {
      const t = i / 7;
      const x = 50 + side * (14 + 22 * Math.sin(t * 1.5));
      const y = 82 - t * 50;
      ctx.fillStyle = i % 2 ? '#9cb04c' : '#7a8f3a';
      ctx.beginPath();
      ctx.ellipse(x + side * 3, y, 4.2, 1.8, side * (0.9 - t * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --- the shield: a heater shape, quartered cobalt and cream
  const shield = () => {
    ctx.beginPath();
    ctx.moveTo(28, 18);
    ctx.lineTo(72, 18);
    ctx.lineTo(72, 46);
    ctx.quadraticCurveTo(72, 70, 50, 82);
    ctx.quadraticCurveTo(28, 70, 28, 46);
    ctx.closePath();
  };
  ctx.save();
  shield();
  ctx.clip();
  ctx.fillStyle = '#2f6fb5';
  ctx.fillRect(28, 18, 22, 32);
  ctx.fillRect(50, 50, 22, 32);
  ctx.fillStyle = '#f3e9d2';
  ctx.fillRect(50, 18, 22, 32);
  ctx.fillRect(28, 50, 22, 32);
  // brass chevron
  ctx.fillStyle = '#c9a227';
  ctx.beginPath();
  ctx.moveTo(28, 64);
  ctx.lineTo(50, 40);
  ctx.lineTo(72, 64);
  ctx.lineTo(72, 72);
  ctx.lineTo(50, 48);
  ctx.lineTo(28, 72);
  ctx.closePath();
  ctx.fill();
  // smokestack (top-left quarter) with a puff
  ctx.fillStyle = '#f3e9d2';
  ctx.fillRect(35, 25, 6, 17);
  ctx.fillRect(33.5, 24, 9, 2.5);
  ctx.beginPath();
  ctx.arc(41, 21, 2.6, 0, Math.PI * 2);
  ctx.arc(45, 20, 1.9, 0, Math.PI * 2);
  ctx.fill();
  // cog (top-right quarter)
  ctx.fillStyle = '#2f6fb5';
  ctx.save();
  ctx.translate(61, 31);
  for (let i = 0; i < 8; i++) {
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-1.4, -7.5, 2.8, 3);
  }
  ctx.beginPath();
  ctx.arc(0, 0, 5.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f3e9d2';
  ctx.beginPath();
  ctx.arc(0, 0, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // sheen
  const sheen = ctx.createLinearGradient(28, 18, 72, 82);
  sheen.addColorStop(0, 'rgba(255,255,255,0.18)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = sheen;
  ctx.fillRect(28, 18, 44, 64);
  ctx.restore();
  shield();
  ctx.strokeStyle = '#e8c75a';
  ctx.lineWidth = 2;
  ctx.stroke();

  // --- inescutcheon with the initials
  ctx.fillStyle = '#1d1a16';
  ctx.beginPath();
  ctx.ellipse(50, 56, 9.5, 8.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#e8c75a';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  const initials = crestInitials(name);
  ctx.fillStyle = '#e8c75a';
  ctx.font = `bold ${initials.length > 1 ? 8 : 10}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials, 50, 56.5);

  // --- ribbon scroll with the company name
  ctx.fillStyle = '#8a6d17';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(50 + side * 34, 84);
    ctx.lineTo(50 + side * 44, 86);
    ctx.lineTo(50 + side * 40, 90);
    ctx.lineTo(50 + side * 44, 94);
    ctx.lineTo(50 + side * 34, 94);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#e8c75a';
  ctx.beginPath();
  ctx.moveTo(14, 82);
  ctx.quadraticCurveTo(50, 90, 86, 82);
  ctx.lineTo(86, 92);
  ctx.quadraticCurveTo(50, 100, 14, 92);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#8a6d17';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.fillStyle = '#2b1d14';
  const label = name.toUpperCase();
  let px = 6;
  ctx.font = `bold ${px}px Georgia, serif`;
  while (px > 3 && ctx.measureText(label).width > 64) {
    px -= 0.25;
    ctx.font = `bold ${px}px Georgia, serif`;
  }
  ctx.fillText(label, 50, 89.5, 66);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// the player's family (sim/dynasty)

/** What drawFamilyPortrait needs of a person (sim/dynasty Person). */
export interface PortraitPerson {
  id: number;
  name: string;
  born: number;
  alive: boolean;
}

export type AgeBracket = 'child' | 'adult' | 'elder';

export const ageBracket = (age: number): AgeBracket => (age < 16 ? 'child' : age < 60 ? 'adult' : 'elder');

const SKIN = ['#f1d2b6', '#e6bf9c', '#d9a983', '#c48d66'];
const HAIR = ['#2a1b12', '#5a3a22', '#8a5a2b', '#b8863a', '#3b2a20', '#a0522d'];
const SITTER_BG = ['#5b6f7d', '#6b5d4a', '#4f6b58', '#6f5468'];

/** A small stable hash of the person's id and name: every look choice reads its own bits. */
function personHash(p: PortraitPerson): number {
  let h = 2166136261 ^ p.id;
  for (let i = 0; i < p.name.length; i++) h = Math.imul(h ^ p.name.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Procedural portrait of a member of the player's family, drawn into the square (0, 0, size, size)
 * of `ctx`; no image assets. Unlike the Baron's oval cameo, a studio photograph: a square walnut
 * frame around a tinted backdrop, a head-and-shoulders sitter. The look (skin, hair colour and style,
 * moustache, backdrop) is fixed by the person's id and name; `female` picks a high lace collar and a
 * bun (or ribbons for a girl) over a collar and tie (and a cap for a boy). The age at `year` sets the
 * bracket: a child is drawn small and round-faced, an elder grey-haired with spectacles. The dead are
 * drawn in sepia with a black mourning ribbon across the corner.
 */
export function drawFamilyPortrait(
  ctx: CanvasRenderingContext2D,
  size: number,
  person: PortraitPerson,
  opts: { year?: number; female?: boolean } = {},
): void {
  const h = personHash(person);
  const bracket = ageBracket((opts.year ?? person.born + 40) - person.born);
  const female = opts.female ?? false;
  const skin = SKIN[h % SKIN.length];
  const hair = bracket === 'elder' ? (h & 64 ? '#d8d4cc' : '#9a958c') : HAIR[(h >>> 3) % HAIR.length];
  const child = bracket === 'child';
  // a child's head is lower in the frame and rounder
  const cy = child ? 50 : 44;
  const rx = child ? 15 : 14;
  const ry = child ? 16 : 18;

  ctx.save();
  ctx.scale(size / 100, size / 100);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // --- frame and backdrop
  ctx.fillStyle = '#4a2e1a';
  ctx.fillRect(0, 0, 100, 100);
  ctx.strokeStyle = '#c9a227';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(5, 5, 90, 90);
  const bg = ctx.createLinearGradient(0, 8, 0, 92);
  bg.addColorStop(0, SITTER_BG[(h >>> 6) % SITTER_BG.length]);
  bg.addColorStop(1, '#1d1a16');
  ctx.fillStyle = bg;
  ctx.fillRect(8, 8, 84, 84);
  ctx.save();
  ctx.beginPath();
  ctx.rect(8, 8, 84, 84);
  ctx.clip();

  // --- shoulders: a dark coat (or a dress) with a collar
  ctx.fillStyle = female ? (h & 128 ? '#5a2a3a' : '#2f3f5a') : '#22242a';
  ctx.beginPath();
  ctx.moveTo(child ? 24 : 16, 94);
  ctx.quadraticCurveTo(50, child ? 62 : 58, child ? 76 : 84, 94);
  ctx.closePath();
  ctx.fill();
  if (female) {
    // high lace collar and a brooch
    ctx.fillStyle = '#efe6d6';
    ctx.fillRect(43, cy + ry - 3, 14, 9);
    ctx.fillStyle = '#c9a227';
    ctx.beginPath();
    ctx.arc(50, cy + ry + 7, 1.8, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // wing collar and a tie
    ctx.fillStyle = '#f2efe6';
    ctx.beginPath();
    ctx.moveTo(42, cy + ry + 1);
    ctx.lineTo(50, cy + ry + 8);
    ctx.lineTo(58, cy + ry + 1);
    ctx.lineTo(50, cy + ry - 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = h & 256 ? '#7a1f1f' : '#1f3a6a';
    ctx.beginPath();
    ctx.moveTo(48.5, cy + ry + 5);
    ctx.lineTo(51.5, cy + ry + 5);
    ctx.lineTo(52.5, cy + ry + 14);
    ctx.lineTo(50, cy + ry + 16);
    ctx.lineTo(47.5, cy + ry + 14);
    ctx.closePath();
    ctx.fill();
  }

  // --- hair behind the head (a bun for a woman, long hair for a girl)
  ctx.fillStyle = hair;
  if (female) {
    ctx.beginPath();
    ctx.ellipse(50, cy - ry + 2, 7, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    if (child) {
      ctx.beginPath();
      ctx.ellipse(50, cy + 4, rx + 3, ry + 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --- face
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(50, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(46, cy + ry - 4, 8, 5);

  // --- hair on top: parted one side or the other, or swept up
  ctx.fillStyle = hair;
  ctx.beginPath();
  const part = h & 512 ? -1 : 1;
  ctx.moveTo(50 - rx - 0.5, cy - 1);
  ctx.quadraticCurveTo(50 - rx, cy - ry - 3, 50 + part * 3, cy - ry - 1);
  ctx.quadraticCurveTo(50 + rx, cy - ry - 2, 50 + rx + 0.5, cy - 1);
  ctx.quadraticCurveTo(50 + part * 4, cy - ry + 6, 50 - rx - 0.5, cy - 1);
  ctx.fill();
  if (bracket === 'elder' && !female) {
    // receding: a bald crown shows through
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.ellipse(50, cy - ry + 3, 7, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- eyes, brows, nose, mouth
  ctx.fillStyle = '#1d1a16';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(50 + side * 5.5, cy - 1, child ? 1.6 : 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = hair;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(50 + side * 3.5, cy - 4.5);
    ctx.lineTo(50 + side * 8, cy - 5 + (h & 1024 ? 0.6 : -0.4));
  }
  ctx.stroke();
  ctx.strokeStyle = '#8a5a3c';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(50, cy);
  ctx.lineTo(49, cy + 5);
  ctx.lineTo(51, cy + 5.5);
  ctx.stroke();
  ctx.strokeStyle = '#7a3a2a';
  ctx.beginPath();
  ctx.moveTo(46.5, cy + 9);
  ctx.quadraticCurveTo(50, cy + (child ? 11.5 : 10), 53.5, cy + 9);
  ctx.stroke();
  if (child) {
    ctx.fillStyle = 'rgba(214, 110, 110, 0.35)';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(50 + side * 8, cy + 4, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --- moustache for some grown men; spectacles for elders
  if (!female && !child && h & 2048) {
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.moveTo(50, cy + 6.5);
    ctx.quadraticCurveTo(44, cy + 5.5, 43, cy + 8.5);
    ctx.quadraticCurveTo(47, cy + 7.8, 50, cy + 7.6);
    ctx.quadraticCurveTo(53, cy + 7.8, 57, cy + 8.5);
    ctx.quadraticCurveTo(56, cy + 5.5, 50, cy + 6.5);
    ctx.fill();
  }
  if (bracket === 'elder') {
    ctx.strokeStyle = '#c9a227';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (const side of [-1, 1]) {
      ctx.moveTo(50 + side * 5.5 + 3, cy - 1);
      ctx.arc(50 + side * 5.5, cy - 1, 3, 0, Math.PI * 2);
    }
    ctx.moveTo(47.5, cy - 1.5);
    ctx.lineTo(52.5, cy - 1.5);
    ctx.stroke();
  }

  // --- a boy's cap or a girl's ribbon
  if (child) {
    if (female) {
      ctx.fillStyle = h & 4096 ? '#c8463a' : '#4a6f9a';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(50 + side * 4, cy - ry - 1, 4, 2.4, side * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = '#4a4038';
      ctx.beginPath();
      ctx.ellipse(50, cy - ry + 3, rx + 1, 6, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(50 - rx - 1, cy - ry + 2, (rx + 1) * 2 + 4, 2);
    }
  }
  ctx.restore();

  // --- the dead: sepia wash and a mourning ribbon
  if (!person.alive) {
    ctx.fillStyle = 'rgba(112, 86, 52, 0.55)';
    ctx.fillRect(8, 8, 84, 84);
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.moveTo(70, 5);
    ctx.lineTo(80, 5);
    ctx.lineTo(95, 20);
    ctx.lineTo(95, 30);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
