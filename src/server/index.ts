import dgram from "dgram";
import fs from "fs";
import path from "path";
import { MessageType, ErrorCode } from "../protocol/types";
import { encodePacket, decodePacket } from "../protocol/packet";
import { md5 } from "../protocol/checksum";
import { SERVER_PORT, SEGMENT_SIZE, FILES_DIR } from "../config";

interface ClientTransfer {
  filename: string;
  fileData: Buffer;
  totalSegments: number;
  fileHash: string;
}

const sendDelayMs = (() => {
  const arg = process.argv.find((a) => a.startsWith("--send-delay-ms="));
  return arg ? parseInt(arg.split("=")[1]) : 0;
})();

const socket = dgram.createSocket("udp4");
const activeTransfers = new Map<string, ClientTransfer>();

const BATCH_SIZE = 64;

function clientKey(address: string, port: number): string {
  return `${address}:${port}`;
}

function sendPacket(packet: Buffer, port: number, address: string): void {
  socket.send(packet, port, address);
}

function sendError(errorCode: ErrorCode, message: string, port: number, address: string): void {
  const packet = encodePacket({ type: MessageType.ERROR, errorCode, message });
  sendPacket(packet, port, address);
}

async function sendSegments(key: string, port: number, address: string, seqNums: number[]): Promise<void> {
  const transfer = activeTransfers.get(key);
  if (!transfer) return;

  for (let i = 0; i < seqNums.length; i++) {
    const seqNum = seqNums[i];
    const start = seqNum * SEGMENT_SIZE;
    const end = Math.min(start + SEGMENT_SIZE, transfer.fileData.length);
    const segmentData = transfer.fileData.subarray(start, end);

    const packet = encodePacket({
      type: MessageType.DATA,
      seqNum,
      totalSegments: transfer.totalSegments,
      dataLength: segmentData.length,
      segmentHash: md5(segmentData),
      data: segmentData,
    });

    sendPacket(packet, port, address);

    if ((i + 1) % BATCH_SIZE === 0) {
      if (sendDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, sendDelayMs));
      } else {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
  }

  const finPacket = encodePacket({
    type: MessageType.FIN,
    totalSegments: transfer.totalSegments,
    fileHash: transfer.fileHash,
  });
  sendPacket(finPacket, port, address);

  console.log(`[${key}] Sent ${seqNums.length} segment(s) + FIN`);
}

function handleRequest(filename: string, port: number, address: string): void {
  const key = clientKey(address, port);
  const filePath = path.join(FILES_DIR, filename);

  if (!fs.existsSync(filePath)) {
    console.log(`[${key}] File not found: ${filename}`);
    sendError(ErrorCode.FILE_NOT_FOUND, `File not found: ${filename}`, port, address);
    return;
  }

  const fileData = fs.readFileSync(filePath);
  const fileHash = md5(fileData);
  const totalSegments = Math.ceil(fileData.length / SEGMENT_SIZE);

  activeTransfers.set(key, { filename, fileData, totalSegments, fileHash });

  console.log(`[${key}] Transfer started: "${filename}" — ${fileData.length} bytes, ${totalSegments} segments`);

  const metadataPacket = encodePacket({
    type: MessageType.METADATA,
    totalSegments,
    fileSize: BigInt(fileData.length),
    fileHash,
    filename,
  });
  sendPacket(metadataPacket, port, address);

  const allSegments = Array.from({ length: totalSegments }, (_, i) => i);
  sendSegments(key, port, address, allSegments);
}

function handleRetransmit(segments: number[], port: number, address: string): void {
  const key = clientKey(address, port);
  console.log(`[${key}] Retransmit request for segments: [${segments.join(", ")}]`);
  sendSegments(key, port, address, segments);
}

socket.on("message", (buf, remoteInfo) => {
  const { address, port } = remoteInfo;

  try {
    const message = decodePacket(buf);

    if (message.type === MessageType.REQUEST) {
      console.log(`[${clientKey(address, port)}] REQUEST "${message.filename}"`);
      handleRequest(message.filename, port, address);
    } else if (message.type === MessageType.RETRANSMIT) {
      handleRetransmit(message.segments, port, address);
    }
  } catch (err) {
    console.error(`[${clientKey(address, port)}] Failed to decode packet: ${err}`);
  }
});

socket.on("listening", () => {
  const addr = socket.address();
  console.log(`Server listening on ${addr.address}:${addr.port}`);
  if (sendDelayMs > 0) {
    console.log(`Send delay: ${sendDelayMs}ms per batch of ${BATCH_SIZE} segments`);
  }
  console.log(`Serving files from: ${FILES_DIR}`);
});

socket.on("error", (err) => {
  console.error(`Server error: ${err.stack}`);
  socket.close();
});

socket.bind(SERVER_PORT);
