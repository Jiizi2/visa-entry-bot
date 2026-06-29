// Auto-generated from shared-protocol/MessageType.ts - DO NOT EDIT MANUALLY
const MessageType = {
  CREATE_SESSION: 'CREATE_SESSION',
  LOAD_BATCH: 'LOAD_BATCH',
  START: 'START',
  NEXT: 'NEXT',
  PAUSE: 'PAUSE',
  STOP: 'STOP',
  PING: 'PING',
  HELLO_ACK: 'HELLO_ACK',
  HELLO: 'HELLO',
  READY: 'READY',
  RUNNING: 'RUNNING',
  CURRENT_MEMBER: 'CURRENT_MEMBER',
  CURRENT_STEP: 'CURRENT_STEP',
  PROGRESS: 'PROGRESS',
  MEMBER_COMPLETED: 'MEMBER_COMPLETED',
  SESSION_COMPLETED: 'SESSION_COMPLETED',
  PONG: 'PONG',
  ACK: 'ACK',
  SESSION_CREATED: 'SESSION_CREATED',
  BATCH_LOADED: 'BATCH_LOADED',
  ERROR: 'ERROR'
};

// Export for Node/CommonJS environments (e.g. tests)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MessageType };
}

// Bind to global scope based on environment
if (typeof window !== 'undefined') {
  window.MessageType = MessageType;
} else if (typeof globalThis !== 'undefined') {
  globalThis.MessageType = MessageType;
} else if (typeof self !== 'undefined') {
  self.MessageType = MessageType;
}
