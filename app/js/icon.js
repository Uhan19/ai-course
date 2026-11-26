const SIZE = 256;
const RADIUS = 58;

export function drawAppIcon() {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const g = canvas.getContext("2d");
  g.fillStyle = "#2b5fa8";
  g.beginPath();
  g.roundRect(0, 0, SIZE, SIZE, RADIUS);
  g.fill();
  g.strokeStyle = "#ffffff";
  g.lineWidth = 26;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(84, 70);
  g.lineTo(84, 178);
  g.lineTo(180, 178);
  g.stroke();
  g.fillStyle = "#9fd0b4";
  g.beginPath();
  g.arc(168, 92, 22, 0, Math.PI * 2);
  g.fill();
  return canvas.toDataURL("image/png");
}
