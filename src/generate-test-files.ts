import fs from "fs";
import path from "path";
import crypto from "crypto";

const FILES_DIR = path.join(process.cwd(), "files");

if (!fs.existsSync(FILES_DIR)) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
}

function generateFile(filename: string, sizeInMB: number): void {
  const sizeInBytes = sizeInMB * 1024 * 1024;
  const filePath = path.join(FILES_DIR, filename);

  const chunkSize = 64 * 1024;
  const writeStream = fs.createWriteStream(filePath);

  let written = 0;
  while (written < sizeInBytes) {
    const remaining = sizeInBytes - written;
    const chunk = crypto.randomBytes(Math.min(chunkSize, remaining));
    writeStream.write(chunk);
    written += chunk.length;
  }

  writeStream.end(() => {
    console.log(`Generated: ${filename} (${sizeInMB} MB) → ${filePath}`);
  });
}

generateFile("small.bin", 2);
generateFile("large.bin", 15);
