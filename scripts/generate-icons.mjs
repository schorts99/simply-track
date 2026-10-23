import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

mkdirSync("public/icons", { recursive: true });
const logo = readFileSync("public/logo.svg", "utf8");
const icon = logo.replace('<rect width="512" height="512"', '<rect width="512" height="512" rx="112"');
writeFileSync("public/icon.svg", icon);
await Promise.all([
  ...[192, 512].map((size) => sharp("public/icon.svg").resize(size, size).png().toFile(`public/icons/icon-${size}.png`)),
  sharp("public/icon.svg").resize(180, 180).png().toFile("public/icons/apple-touch-icon.png"),
  sharp(Buffer.from(logo)).resize(360, 360).extend({ top: 76, bottom: 76, left: 76, right: 76, background: "#6d67cd" }).png().toFile("public/icons/maskable-512.png"),
]);
const png = await sharp("public/icon.svg").resize(48, 48).png().toBuffer();
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico[6] = ico[7] = 48;
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18);
writeFileSync("app/favicon.ico", Buffer.concat([ico, png]));
