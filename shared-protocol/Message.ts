import { MessageType } from './MessageType';

export interface Envelope {
  protocolVersion: number;
  type: MessageType;
  messageId: string;
  sessionId: string;
  correlationId: string;
  timestamp: string; // ISO 8601 UTC
  replyToMessageId?: string;
  payload: any;
}

export interface HelloPayload {
  extensionVersion: string;
  browser: string;
  capabilities: {
    supportsDebugger: boolean;
    supportsScreenshot: boolean;
    supportsResume: boolean;
  };
}

export interface HelloAckPayload {
  authToken: string;
}

export interface CreateSessionPayload {
  workspaceId: string;
}

export interface SessionCreatedPayload {
  status: 'initialized';
}

export interface MemberProfile {
  profesi?: string;
  statusNikah?: string;
  tipePassport?: string;
}

export interface Member {
  id: string;
  name: string;
  passportNumber: string;
  passportImagePath: string;
  companionId?: string;
  resolvedProfile?: MemberProfile;
}

export interface LoadBatchPayload {
  members: Member[];
}

export interface ReadyPayload {
  currentUrl: string;
}

export interface RunningPayload {
  currentMemberIndex: number;
  progress: {
    current: number;
    total: number;
  };
}

export interface CurrentMemberPayload {
  memberId: string;
}

export interface CurrentStepPayload {
  stepName: string;
}

export interface ProgressPayload {
  current: number;
  total: number;
}

export interface MemberCompletedPayload {
  memberId: string;
}

export interface SessionCompletedPayload {
  totalSuccess: number;
  totalFailed: number;
}

export interface ErrorPayload {
  code: string;
  message: string;
  recoverable: boolean;
  details?: Record<string, any>;
}

export interface MessageMap {
  [MessageType.HELLO]: HelloPayload;
  [MessageType.HELLO_ACK]: HelloAckPayload;
  [MessageType.CREATE_SESSION]: CreateSessionPayload;
  [MessageType.SESSION_CREATED]: SessionCreatedPayload;
  [MessageType.LOAD_BATCH]: LoadBatchPayload;
  [MessageType.BATCH_LOADED]: Record<string, never>;
  [MessageType.START]: Record<string, never>;
  [MessageType.NEXT]: Record<string, never>;
  [MessageType.PAUSE]: Record<string, never>;
  [MessageType.STOP]: Record<string, never>;
  [MessageType.PING]: Record<string, never>;
  [MessageType.READY]: ReadyPayload;
  [MessageType.RUNNING]: RunningPayload;
  [MessageType.CURRENT_MEMBER]: CurrentMemberPayload;
  [MessageType.CURRENT_STEP]: CurrentStepPayload;
  [MessageType.PROGRESS]: ProgressPayload;
  [MessageType.MEMBER_COMPLETED]: MemberCompletedPayload;
  [MessageType.SESSION_COMPLETED]: SessionCompletedPayload;
  [MessageType.PONG]: Record<string, never>;
  [MessageType.ACK]: Record<string, never>;
  [MessageType.ERROR]: ErrorPayload;
}

export interface TypedMessage<T extends MessageType> extends Envelope {
  type: T;
  payload: MessageMap[T];
}
