import dgram from "dgram";
import fs from "fs";
import path from "path";
import { MessageType } from "../protocol/types";
import { encodePacket, decodePacket } from "../protocol/packet";
import { md5, verifyMd5 } from "../protocol/checksum";
import { CONNECTION_TIMEOUT_MS, RETRANSMIT_TIMEOUT_MS, MAX_RETRANSMIT_ATTEMPTS, DOWNLOADS_DIR } from "../config";

function parseArgs() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: npm run client -- <IP>:<PORT>/<filename> [--loss-rate=<0-1>] [--drop=<seq1,seq2,...>]");
    console.error("Example: npm run client -- 127.0.0.1:3000/largefile.bin --loss-rate=0.1 --drop=3,7,12");
    process.exit(1);
  }

  const targetMatch = args[0].match(/^([\d.]+):(\d+)\/(.+)$/);
  if (!targetMatch) {
    console.error("Invalid format. Expected: <IP>:<PORT>/<filename>");
    process.exit(1);
  }

  const serverAddress = targetMatch[1];
  const serverPort = parseInt(targetMatch[2]);
  const filename = targetMatch[3];

  let lossRate = 0;
  const forcedDrops = new Set<number>();

  for (const arg of args.slice(1)) {
    if (arg.startsWith("--loss-rate=")) {
      lossRate = parseFloat(arg.split("=")[1]);
    } else if (arg.startsWith("--drop=")) {
      arg.split("=")[1].split(",").map(Number).forEach((n) => forcedDrops.add(n));
    }
  }

  return { serverAddress, serverPort, filename, lossRate, forcedDrops };
}

function main() {
  const { serverAddress, serverPort, filename, lossRate, forcedDrops } = parseArgs();

  console.log(`Connecting to ${serverAddress}:${serverPort}`);
  console.log(`Requesting: ${filename}`);

  if (lossRate > 0) {
    console.log(`Loss simulation: random drop rate = ${(lossRate * 100).toFixed(0)}%`);
  }
  if (forcedDrops.size > 0) {
    console.log(`Loss simulation: forced drops = [${[...forcedDrops].join(", ")}]`);
  }

  const socket = dgram.createSocket("udp4");

  const receivedSegments = new Map<number, Buffer>();
  let totalSegments = 0;
  let expectedFileHash = "";
  let receivedFilename = "";
  let metadataReceived = false;
  let retransmitAttempts = 0;
  let retransmitTimer: NodeJS.Timeout | null = null;

  function shouldDropSegment(seqNum: number): boolean {
    if (forcedDrops.has(seqNum)) {
      forcedDrops.delete(seqNum);
      return true;
    }
    return lossRate > 0 && Math.random() < lossRate;
  }

  function getMissingSegments(): number[] {
    const missing: number[] = [];
    for (let i = 0; i < totalSegments; i++) {
      if (!receivedSegments.has(i)) missing.push(i);
    }
    return missing;
  }

  function requestRetransmit(missing: number[]): void {
    retransmitAttempts++;
    console.log(`\nRequesting retransmit (attempt ${retransmitAttempts}/${MAX_RETRANSMIT_ATTEMPTS}): [${missing.join(", ")}]`);
    const packet = encodePacket({ type: MessageType.RETRANSMIT, segments: missing });
    socket.send(packet, serverPort, serverAddress);
  }

  function scheduleRetransmitTimeout(): void {
    if (retransmitTimer) clearTimeout(retransmitTimer);
    retransmitTimer = setTimeout(() => {
      const missing = getMissingSegments();
      if (missing.length === 0) return;

      if (retransmitAttempts >= MAX_RETRANSMIT_ATTEMPTS) {
        console.error(`\nServer not responding after ${MAX_RETRANSMIT_ATTEMPTS} retransmit attempts. Transfer failed.`);
        socket.close();
        return;
      }

      console.log(`\nTimeout! Still missing ${missing.length} segment(s). Retrying...`);
      requestRetransmit(missing);
      scheduleRetransmitTimeout();
    }, RETRANSMIT_TIMEOUT_MS);
  }

  function assembleAndSave(): void {
    if (retransmitTimer) clearTimeout(retransmitTimer);

    process.stdout.write("\n");
    console.log("All segments received. Verifying file integrity...");

    const chunks: Buffer[] = [];
    for (let i = 0; i < totalSegments; i++) {
      chunks.push(receivedSegments.get(i)!);
    }
    const fileData = Buffer.concat(chunks);

    if (!verifyMd5(fileData, expectedFileHash)) {
      console.error("File integrity check FAILED — MD5 mismatch.");
      socket.close();
      return;
    }

    console.log(`File integrity check PASSED (MD5: ${md5(fileData)})`);

    if (!fs.existsSync(DOWNLOADS_DIR)) {
      fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    }

    const savePath = path.join(DOWNLOADS_DIR, receivedFilename);
    fs.writeFileSync(savePath, fileData);
    console.log(`File saved: ${savePath}`);

    socket.close();
  }

  function handleMetadata(totalSegs: number, fileHash: string, fname: string, fileSize: bigint): void {
    totalSegments = totalSegs;
    expectedFileHash = fileHash;
    receivedFilename = fname;
    metadataReceived = true;
    console.log(`Transfer info: "${fname}" — ${fileSize} bytes, ${totalSegs} segments`);
    scheduleRetransmitTimeout();
  }

  function handleData(seqNum: number, segmentHash: string, data: Buffer): void {
    if (!metadataReceived) return;

    if (shouldDropSegment(seqNum)) {
      console.log(`\n[DROP] Segment ${seqNum} discarded (loss simulation)`);
      return;
    }

    if (!verifyMd5(data, segmentHash)) {
      console.warn(`\n[CORRUPT] Segment ${seqNum} failed integrity check — will request retransmit`);
      return;
    }

    if (!receivedSegments.has(seqNum)) {
      receivedSegments.set(seqNum, data);
      retransmitAttempts = 0;
    }

    process.stdout.write(`\rProgress: ${receivedSegments.size}/${totalSegments} segments received`);
  }

  function handleFin(): void {
    const missing = getMissingSegments();
    if (missing.length === 0) {
      assembleAndSave();
    } else {
      console.log(`\nFIN received — missing ${missing.length} segment(s).`);
      requestRetransmit(missing);
      scheduleRetransmitTimeout();
    }
  }

  socket.on("message", (buf) => {
    try {
      const message = decodePacket(buf);

      switch (message.type) {
        case MessageType.ERROR:
          console.error(`\nServer error: ${message.message}`);
          socket.close();
          break;
        case MessageType.METADATA:
          handleMetadata(message.totalSegments, message.fileHash, message.filename, message.fileSize);
          break;
        case MessageType.DATA:
          handleData(message.seqNum, message.segmentHash, message.data);
          break;
        case MessageType.FIN:
          handleFin();
          break;
      }
    } catch (err) {
      console.error(`Failed to decode packet: ${err}`);
    }
  });

  socket.on("error", (err) => {
    console.error(`Socket error: ${err.message}`);
    socket.close();
  });

  socket.on("close", () => {
    if (retransmitTimer) clearTimeout(retransmitTimer);
    clearTimeout(connectionTimeout);
  });

  const requestPacket = encodePacket({ type: MessageType.REQUEST, filename });
  socket.send(requestPacket, serverPort, serverAddress, (err) => {
    if (err) {
      console.error(`Failed to send request: ${err.message}`);
      socket.close();
    }
  });

  const connectionTimeout = setTimeout(() => {
    if (!metadataReceived) {
      console.error("Connection timeout — server did not respond.");
      socket.close();
    }
  }, CONNECTION_TIMEOUT_MS);
}

main();
