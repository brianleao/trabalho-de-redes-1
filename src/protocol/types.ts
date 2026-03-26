export enum MessageType {
  REQUEST = 0x01,
  METADATA = 0x02,
  DATA = 0x03,
  RETRANSMIT = 0x04,
  ERROR = 0x05,
  FIN = 0x06,
}

export enum ErrorCode {
  FILE_NOT_FOUND = 0x01,
  INTERNAL_ERROR = 0x02,
}

export interface RequestMessage {
  type: MessageType.REQUEST;
  filename: string;
}

export interface MetadataMessage {
  type: MessageType.METADATA;
  totalSegments: number;
  fileSize: bigint;
  fileHash: string;
  filename: string;
}

export interface DataMessage {
  type: MessageType.DATA;
  seqNum: number;
  totalSegments: number;
  dataLength: number;
  segmentHash: string;
  data: Buffer;
}

export interface RetransmitMessage {
  type: MessageType.RETRANSMIT;
  segments: number[];
}

export interface ErrorMessage {
  type: MessageType.ERROR;
  errorCode: ErrorCode;
  message: string;
}

export interface FinMessage {
  type: MessageType.FIN;
  totalSegments: number;
  fileHash: string;
}

export type Message =
  | RequestMessage
  | MetadataMessage
  | DataMessage
  | RetransmitMessage
  | ErrorMessage
  | FinMessage;
