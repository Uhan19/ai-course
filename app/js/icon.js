const SIZE = 256;
const RADIUS = 58;

export function drawAppIcon(name) {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const g = canvas.getContext("2d");
  g.fillStyle = "#2b5fa8";
  g.beginPath();
  g.roundRect(0, 0, SIZE, SIZE, RADIUS);
  g.fill();
  g.fillStyle = "#ffffff";
  g.font = '700 168px "Bricolage Grotesque", "Avenir Next", system-ui, sans-serif';
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(name).charAt(0).toUpperCase(), SIZE / 2, SIZE / 2 + 8);
  return canvas.toDataURL("image/png");
}
