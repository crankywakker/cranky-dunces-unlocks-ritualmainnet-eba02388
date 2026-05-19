import cardTemplate from "@/assets/dunce-card-template.png";

/**
 * Composes a personalized Dunce share card by drawing the minter's PFP,
 * dunce number, and handle onto the card template. Returns a PNG Blob.
 */
export async function buildShareCard(opts: {
  pfpUrl: string;
  dunceNumber: number | bigint;
  handle: string;
}): Promise<Blob> {
  const [template, pfp] = await Promise.all([
    loadImage(cardTemplate),
    loadImage(opts.pfpUrl, true),
  ]);

  const W = 1600;
  const H = 900;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // Base template
  ctx.drawImage(template, 0, 0, W, H);

  // PFP circle (matches template ring at ~cx 330, cy 405, r 148)
  const cx = 330;
  const cy = 405;
  const r = 148;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  // cover-fit pfp into circle bounds
  const size = r * 2;
  const ratio = Math.max(size / pfp.width, size / pfp.height);
  const dw = pfp.width * ratio;
  const dh = pfp.height * ratio;
  ctx.drawImage(pfp, cx - dw / 2, cy - dh / 2, dw, dh);
  ctx.restore();

  // DUNCE #NNN — orange→gold gradient, heavy sans
  const num = String(Number(opts.dunceNumber)).padStart(3, "0");
  const dunceText = `DUNCE #${num}`;
  ctx.font =
    '800 96px Inter, "Helvetica Neue", Arial, system-ui, sans-serif';
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const grad = ctx.createLinearGradient(625, 0, 1400, 0);
  grad.addColorStop(0, "#f08a3c");
  grad.addColorStop(1, "#f5c84b");
  ctx.fillStyle = grad;
  ctx.fillText(dunceText, 625, 395);

  // @handle
  ctx.font =
    '500 40px Inter, "Helvetica Neue", Arial, system-ui, sans-serif';
  ctx.fillStyle = "#ffffff";
  const handle = opts.handle.replace(/^@/, "");
  ctx.fillText(`@${handle}`, 625, 495);

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas export failed"))),
      "image/png",
    ),
  );
}

function loadImage(src: string, crossOrigin = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}
