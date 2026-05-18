#!/usr/bin/env node
/**
 * Inspecciona la estructura interna de un archivo .tar del NVR Vivotek
 * Uso: node inspect-tar.js ruta/al/archivo.tar
 */

const fs   = require("fs");
const path = require("path");

const tarPath = process.argv[2];
if (!tarPath) {
  console.error("Uso: node inspect-tar.js ruta/al/archivo.tar");
  process.exit(1);
}

if (!fs.existsSync(tarPath)) {
  console.error(`No se encontró: ${tarPath}`);
  process.exit(1);
}

const buf    = fs.readFileSync(tarPath);
let   offset = 0;
let   entry  = 0;

console.log(`\nTAR: ${tarPath}`);
console.log(`Tamaño total: ${buf.length} bytes (${(buf.length / 1024).toFixed(1)} KB)\n`);
console.log("─".repeat(80));

while (offset + 512 <= buf.length) {
  const nameBytes = buf.slice(offset, offset + 100);
  const name      = nameBytes.toString("utf8").replace(/\0/g, "").trim();
  if (!name) {
    console.log(`[offset ${offset}] → bloque vacío (fin del tar)`);
    break;
  }

  const sizeOctal = buf.slice(offset + 124, offset + 136).toString("utf8").replace(/\0/g, "").trim();
  const fileSize  = parseInt(sizeOctal, 8) || 0;

  // Tipo de entrada (byte 156): '0' o '\0' = archivo, '5' = directorio, '2' = symlink
  const typeFlag  = buf[offset + 156];
  const typeStr   = typeFlag === 0x35 ? "DIR " : typeFlag === 0x32 ? "LINK" : "FILE";

  // Checksum declarado
  const checksumOctal = buf.slice(offset + 148, offset + 156).toString("utf8").replace(/\0/g, "").trim();
  const checksum      = parseInt(checksumOctal, 8) || 0;

  // Primeros bytes del contenido
  const dataOffset  = offset + 512;
  const preview     = fileSize > 0 && typeStr === "FILE"
    ? buf.slice(dataOffset, dataOffset + 16).toString("hex")
    : "(sin datos)";

  console.log(`Entrada #${++entry}`);
  console.log(`  Nombre    : ${name}`);
  console.log(`  Tipo      : ${typeStr}  (flag: 0x${typeFlag.toString(16).padStart(2,"0")})`);
  console.log(`  Tamaño    : ${fileSize} bytes (${(fileSize / 1024).toFixed(1)} KB)`);
  console.log(`  Header en : offset ${offset}`);
  console.log(`  Datos en  : offset ${dataOffset}`);
  console.log(`  Primeros 16 bytes: ${preview}`);
  console.log("─".repeat(80));

  offset += 512 + Math.ceil(fileSize / 512) * 512;
}

console.log(`\nFin. Offset final: ${offset} / ${buf.length} bytes`);
console.log(`Bytes sin procesar: ${buf.length - offset}\n`);
