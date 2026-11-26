const SIZE = 256;

export function drawAppIcon() {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const g = canvas.getContext("2d");
  g.fillStyle = "#0c1b26";
  roundRect(g, 0, 0, SIZE, SIZE, 56);
  g.fill();
  g.strokeStyle = "rgba(127, 214, 232, 0.25)";
  g.lineWidth = 2;
  for (let y = 48; y < SIZE; y += 32) {
    g.beginPath();
    g.moveTo(32, y);
    g.lineTo(SIZE - 32, y);
    g.stroke();
  }
  const blocks = [
    [44, 76, 52, "#7fd6e8"],
    [104, 76, 36, "#7fd6e8"],
    [148, 76, 64, "#7fd6e8"],
    [44, 140, 70, "#f2c46d"],
    [122, 140, 40, "#f2c46d"],
    [170, 140, 42, "#f2c46d"],
  ];
  for (const [x, y, w, color] of blocks) {
    g.fillStyle = color;
    roundRect(g, x, y, w, 40, 10);
    g.fill();
  }
  return canvas.toDataURL("image/png");
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
