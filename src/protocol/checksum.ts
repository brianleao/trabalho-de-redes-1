import crypto from "crypto";

export function md5(data: Buffer): string {
  return crypto.createHash("md5").update(data).digest("hex");
}

export function verifyMd5(data: Buffer, expectedHash: string): boolean {
  return md5(data) === expectedHash;
}
