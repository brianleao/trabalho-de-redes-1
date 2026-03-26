import { Message, MessageType, ErrorCode } from "./types";

function hexToBytes(hex: string): Buffer {
  return Buffer.from(hex, "hex");
}

function bytesToHex(buf: Buffer, offset: number, length: number): string {
  return buf.subarray(offset, offset + length).toString("hex");
}

export function encodePacket(message: Message): Buffer {
  switch (message.type) {
    case MessageType.REQUEST: {
      const filenameBytes = Buffer.from(message.filename, "utf8");
      const buf = Buffer.allocUnsafe(1 + filenameBytes.length);
      buf.writeUInt8(message.type, 0);
      filenameBytes.copy(buf, 1);
      return buf;
    }

    case MessageType.METADATA: {
      const filenameBytes = Buffer.from(message.filename, "utf8");
      const buf = Buffer.allocUnsafe(1 + 4 + 8 + 16 + filenameBytes.length);
      let offset = 0;
      buf.writeUInt8(message.type, offset); offset += 1;
      buf.writeUInt32BE(message.totalSegments, offset); offset += 4;
      buf.writeBigUInt64BE(message.fileSize, offset); offset += 8;
      hexToBytes(message.fileHash).copy(buf, offset); offset += 16;
      filenameBytes.copy(buf, offset);
      return buf;
    }

    case MessageType.DATA: {
      const buf = Buffer.allocUnsafe(1 + 4 + 4 + 4 + 16 + message.data.length);
      let offset = 0;
      buf.writeUInt8(message.type, offset); offset += 1;
      buf.writeUInt32BE(message.seqNum, offset); offset += 4;
      buf.writeUInt32BE(message.totalSegments, offset); offset += 4;
      buf.writeUInt32BE(message.dataLength, offset); offset += 4;
      hexToBytes(message.segmentHash).copy(buf, offset); offset += 16;
      message.data.copy(buf, offset);
      return buf;
    }

    case MessageType.RETRANSMIT: {
      const buf = Buffer.allocUnsafe(1 + 4 + message.segments.length * 4);
      let offset = 0;
      buf.writeUInt8(message.type, offset); offset += 1;
      buf.writeUInt32BE(message.segments.length, offset); offset += 4;
      for (const seqNum of message.segments) {
        buf.writeUInt32BE(seqNum, offset); offset += 4;
      }
      return buf;
    }

    case MessageType.ERROR: {
      const messageBytes = Buffer.from(message.message, "utf8");
      const buf = Buffer.allocUnsafe(1 + 2 + messageBytes.length);
      buf.writeUInt8(message.type, 0);
      buf.writeUInt16BE(message.errorCode, 1);
      messageBytes.copy(buf, 3);
      return buf;
    }

    case MessageType.FIN: {
      const buf = Buffer.allocUnsafe(1 + 4 + 16);
      buf.writeUInt8(message.type, 0);
      buf.writeUInt32BE(message.totalSegments, 1);
      hexToBytes(message.fileHash).copy(buf, 5);
      return buf;
    }
  }
}

export function decodePacket(buf: Buffer): Message {
  const type = buf.readUInt8(0) as MessageType;

  switch (type) {
    case MessageType.REQUEST: {
      const filename = buf.subarray(1).toString("utf8");
      return { type, filename };
    }

    case MessageType.METADATA: {
      let offset = 1;
      const totalSegments = buf.readUInt32BE(offset); offset += 4;
      const fileSize = buf.readBigUInt64BE(offset); offset += 8;
      const fileHash = bytesToHex(buf, offset, 16); offset += 16;
      const filename = buf.subarray(offset).toString("utf8");
      return { type, totalSegments, fileSize, fileHash, filename };
    }

    case MessageType.DATA: {
      let offset = 1;
      const seqNum = buf.readUInt32BE(offset); offset += 4;
      const totalSegments = buf.readUInt32BE(offset); offset += 4;
      const dataLength = buf.readUInt32BE(offset); offset += 4;
      const segmentHash = bytesToHex(buf, offset, 16); offset += 16;
      const data = Buffer.from(buf.subarray(offset, offset + dataLength));
      return { type, seqNum, totalSegments, dataLength, segmentHash, data };
    }

    case MessageType.RETRANSMIT: {
      let offset = 1;
      const count = buf.readUInt32BE(offset); offset += 4;
      const segments: number[] = [];
      for (let i = 0; i < count; i++) {
        segments.push(buf.readUInt32BE(offset)); offset += 4;
      }
      return { type, segments };
    }

    case MessageType.ERROR: {
      const errorCode = buf.readUInt16BE(1) as ErrorCode;
      const message = buf.subarray(3).toString("utf8");
      return { type, errorCode, message };
    }

    case MessageType.FIN: {
      const totalSegments = buf.readUInt32BE(1);
      const fileHash = bytesToHex(buf, 5, 16);
      return { type, totalSegments, fileHash };
    }

    default:
      throw new Error(`Unknown packet type: 0x${(type as number).toString(16)}`);
  }
}
