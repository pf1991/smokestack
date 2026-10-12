/**
 * Procedural portrait of Baron Cornelius Smogsworth: top hat, monocle on a gold chain, mutton
 * chops and a waxed moustache. `smug` sneers with one eyebrow cocked; `furious` scowls, red-faced.
 * Drawn into the square (0, 0, size, size) of `ctx`; no image assets.
 */
export type BaronMood = 'smug' | 'furious';

export function drawBaronPortrait(ctx: CanvasRenderingContext2D, size: number, mood: BaronMood): void {
  const furious = mood === 'furious';
  ctx.save();
  ctx.scale(size / 100, size / 100);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // --- backdrop: an oval cameo, crimson velvet with a vignette
  const bg = ctx.createRadialGradient(50, 45, 8, 50, 50, 62);
  bg.addColorStop(0, furious ? '#c8463a' : '#a8423a');
  bg.addColorStop(1, '#3a1210');
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

  // --- frock coat, collar and cravat
  ctx.fillStyle = '#1b1716';
  ctx.beginPath();
  ctx.moveTo(8, 100);
  ctx.quadraticCurveTo(14, 76, 34, 72);
  ctx.lineTo(66, 72);
  ctx.quadraticCurveTo(86, 76, 92, 100);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f2ece0';
  ctx.beginPath();
  ctx.moveTo(38, 72);
  ctx.lineTo(50, 90);
  ctx.lineTo(62, 72);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#7a1c1a';
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
  // lapels
  ctx.strokeStyle = '#3a302c';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(36, 73);
  ctx.lineTo(44, 98);
  ctx.moveTo(64, 73);
  ctx.lineTo(56, 98);
  ctx.stroke();

  // --- face
  const skin = furious ? '#e79a80' : '#e9b996';
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(50, 52, 17, 21, 0, 0, Math.PI * 2);
  ctx.fill();
  // ears
  ctx.beginPath();
  ctx.ellipse(33, 52, 3, 5, 0, 0, Math.PI * 2);
  ctx.ellipse(67, 52, 3, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  // ruddy cheeks
  ctx.fillStyle = furious ? 'rgba(200,30,30,0.45)' : 'rgba(200,80,70,0.25)';
  ctx.beginPath();
  ctx.ellipse(40, 58, 5, 3.5, 0, 0, Math.PI * 2);
  ctx.ellipse(60, 58, 5, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // --- mutton chops: bushy grey-brown sideburns sweeping into the cheeks
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

  // --- nose
  ctx.fillStyle = furious ? '#d77a63' : '#dba383';
  ctx.beginPath();
  ctx.moveTo(50, 48);
  ctx.quadraticCurveTo(54, 57, 52, 59);
  ctx.quadraticCurveTo(49, 60, 47, 58);
  ctx.closePath();
  ctx.fill();

  // --- eyes and brows
  ctx.fillStyle = '#1d1a16';
  ctx.beginPath();
  ctx.ellipse(43, 49, 1.6, furious ? 1.2 : 1.0, 0, 0, Math.PI * 2);
  ctx.ellipse(57, 49, 1.6, furious ? 1.4 : 1.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#4e443d';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  if (furious) {
    // a deep V scowl
    ctx.moveTo(37, 42);
    ctx.lineTo(48, 46);
    ctx.moveTo(63, 42);
    ctx.lineTo(52, 46);
  } else {
    // left brow lowered, right brow cocked above the monocle
    ctx.moveTo(37, 45);
    ctx.lineTo(47, 46);
    ctx.moveTo(52, 42);
    ctx.quadraticCurveTo(57, 39, 63, 42);
  }
  ctx.stroke();
  if (furious) {
    // throbbing temple vein
    ctx.strokeStyle = '#a3302a';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(60, 36);
    ctx.lineTo(62, 38);
    ctx.lineTo(60, 40);
    ctx.stroke();
  }

  // --- monocle over the right eye, chain to the lapel
  ctx.strokeStyle = '#e8c75a';
  ctx.lineWidth = 1.4;
  ctx.fillStyle = 'rgba(220,235,255,0.28)';
  ctx.beginPath();
  ctx.arc(57, 49, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.arc(55.3, 47.2, 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c9a227';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([1.2, 1]);
  ctx.beginPath();
  ctx.moveTo(61.5, 51);
  ctx.bezierCurveTo(70, 62, 66, 74, 61, 82);
  ctx.stroke();
  ctx.setLineDash([]);

  // --- waxed handlebar moustache
  ctx.fillStyle = '#5a4f48';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(50, 60);
    ctx.quadraticCurveTo(50 + side * 8, 58, 50 + side * 13, 62);
    ctx.quadraticCurveTo(50 + side * 17, 63, 50 + side * 17, furious ? 66 : 57);
    ctx.quadraticCurveTo(50 + side * 14, 65, 50 + side * 7, 63.5);
    ctx.quadraticCurveTo(50 + side * 2, 63, 50, 62.5);
    ctx.closePath();
    ctx.fill();
  }

  // --- mouth: a lopsided sneer, or a bared-teeth scowl
  ctx.strokeStyle = '#6b2a24';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (furious) {
    ctx.fillStyle = '#4a1a16';
    ctx.moveTo(44, 68);
    ctx.quadraticCurveTo(50, 64.5, 56, 68);
    ctx.quadraticCurveTo(50, 66.8, 44, 68);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#f4efe2';
    ctx.fillRect(46.5, 66.2, 7, 1.1);
  } else {
    ctx.moveTo(45, 66.5);
    ctx.quadraticCurveTo(50, 67.5, 54, 66);
    ctx.quadraticCurveTo(56, 65, 57, 63.5);
    ctx.stroke();
  }
  // jowly chin line
  ctx.strokeStyle = 'rgba(120,70,50,0.35)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(50, 64, 9, Math.PI * 0.25, Math.PI * 0.75);
  ctx.stroke();

  // --- top hat, tilted a touch
  ctx.save();
  ctx.translate(50, 32);
  ctx.rotate(furious ? 0.04 : -0.08);
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

  ctx.restore(); // clip

  // gilt nameplate
  ctx.fillStyle = '#c9a227';
  ctx.fillRect(30, 92, 40, 6);
  ctx.fillStyle = '#2b1d14';
  ctx.font = 'bold 4.2px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SMOGSWORTH', 50, 95.2);

  ctx.restore();
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
