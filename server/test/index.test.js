import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import WebSocket from 'ws';

import serverModule from '../index.js';
const { app, server } = serverModule;

let baseURL;
let uploadedFileId;
let client1;
let client2;
const WS_URL = 'ws://localhost:4000';

// Test Helpers

// Force-close test sockets safely during cleanup.
function terminateClient(client) {
  if (!client) return;
  client.on('error', () => {});
  if (
    client.readyState === WebSocket.CONNECTING ||
    client.readyState === WebSocket.OPEN
  ) {
    client.terminate();
  }
}

// Wait until this socket receives a specific message type.
function waitForMessageOfType(client, type, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.off('message', onMessage);
      reject(new Error(`Timed out waiting for message type: ${type}`));
    }, timeoutMs);

    const onMessage = (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      if (msg.type === type) {
        clearTimeout(timeout);
        client.off('message', onMessage);
        resolve(msg);
      }
    };

    client.on('message', onMessage);
  });
}

// Create a WebSocket client and wait for the initial "init" payload.
function connectAndInitClient() {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(WS_URL);

    const timeout = setTimeout(() => {
      client.off('error', onError);
      client.off('message', onMessage);
      reject(new Error('Timed out waiting for init message'));
    }, 3000);

    const onError = (err) => {
      clearTimeout(timeout);
      client.off('message', onMessage);
      reject(err);
    };

    const onMessage = (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      if (msg.type === 'init') {
        clearTimeout(timeout);
        client.off('error', onError);
        client.off('message', onMessage);
        resolve({ client, init: msg });
      }
    };

    client.on('error', onError);
    client.on('message', onMessage);
  });
}

// Global Hooks
// Start a dedicated test server before any test runs.
beforeAll(async () => {
  const PORT = 4000;

  await new Promise((resolve) => {
    server.listen(PORT, () => {
      baseURL = `http://localhost:${PORT}`;
      resolve();
    });
  });
});

// Clean up sockets and stop the server after all tests finish.
afterAll(async () => {
  terminateClient(client1);
  terminateClient(client2);

  await new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});


// HTTP API Tests

// Health endpoint tests
describe('Health Endpoint', () => {
  // Confirms the API is alive and responds with OK.
  it('should return OK', async () => {
    const res = await request(baseURL).get('/health');

    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');
  });
});

// Single file upload tests
describe('Single File Upload', () => {
  // Upload one file and store the returned id for later download tests.
  it('should upload file and return file id', async () => {
    const res = await request(baseURL)
      .post('/upload')
      .attach('file', Buffer.from('hello world'), 'test.txt');

    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();

    // Save this id so the download test can fetch the same file.
    uploadedFileId = res.body.id;
  });

  // Sending no file should return a validation error.
  it('should fail if no file is sent', async () => {
    const res = await request(baseURL).post('/upload');

    expect(res.status).toBe(400);
  });
});

// File download tests
describe('Download File', () => {
  // Downloads the file uploaded in the previous test block.
  it('should download file using valid id', async () => {
    const res = await request(baseURL).get(`/download/${uploadedFileId}`);

    expect(res.status).toBe(200);
  });

  // Unknown ids should return 404.
  it('should return 404 for wrong id', async () => {
    const res = await request(baseURL).get('/download/wrong-id');

    expect(res.status).toBe(404);
  });
});

// Batch upload tests
describe('Batch Upload', () => {
  // Uploads two files in one request and checks both are accepted.
  it('should upload multiple files', async () => {
    const res = await request(baseURL)
      .post('/upload-batch')
      .attach('files', Buffer.from('file1'), 'a.txt')
      .attach('files', Buffer.from('file2'), 'b.txt');

    expect(res.status).toBe(200);
    expect(res.body.files.length).toBe(2);
  });

  // Sending an empty batch should fail.
  it('should fail if no files are sent', async () => {
    const res = await request(baseURL).post('/upload-batch');

    expect(res.status).toBe(400);
  });
});

// WebSocket signaling tests
describe('WebSocket Tests', () => {
  // First client should receive an init message with its generated id.
  it('should connect and receive init message', async () => {
    client1 = new WebSocket('ws://localhost:4000');

    const msg = await waitForMessageOfType(client1, 'init');
    expect(msg.id).toBeDefined();
  });

  // When a second client connects, the first client should get peer-joined.
  it('should notify when a new client joins', async () => {
    client2 = new WebSocket('ws://localhost:4000');

    const msg = await waitForMessageOfType(client1, 'peer-joined');
    expect(msg.peer).toBeDefined();
  });

  // When a connected peer leaves, others should receive peer-left.
  it('should notify when a client leaves', async () => {
    const peerLeftPromise = waitForMessageOfType(client1, 'peer-left');

    if (client2.readyState === WebSocket.OPEN) {
      client2.close();
    } else {
      client2.once('open', () => {
        client2.close();
      });
    }

    const msg = await peerLeftPromise;
    expect(msg.peerId).toBeDefined();
  });
});

// WebSocket message routing tests
describe('WebSocket Signaling Routing', () => {
  // Send an offer from one client and check it reaches the target client.
  it('should forward offer to target peer', async () => {
    let sender;
    let receiver;

    try {
      const senderConn = await connectAndInitClient();
      sender = senderConn.client;
      const senderId = senderConn.init.id;

      const receiverConn = await connectAndInitClient();
      receiver = receiverConn.client;
      const receiverId = receiverConn.init.id;

      const offerPayload = {
        sdp: 'fake-offer-sdp',
        type: 'offer',
      };

      sender.send(
        JSON.stringify({
          type: 'offer',
          target: receiverId,
          offer: offerPayload,
        })
      );

      const forwarded = await waitForMessageOfType(receiver, 'offer');
      expect(forwarded.sender).toBe(senderId);
      expect(forwarded.offer).toEqual(offerPayload);
    } finally {
      terminateClient(sender);
      terminateClient(receiver);
    }
  });

  // Send an answer to the caller and check the caller receives it.
  it('should forward answer to target peer', async () => {
    let caller;
    let callee;

    try {
      const callerConn = await connectAndInitClient();
      caller = callerConn.client;
      const callerId = callerConn.init.id;

      const calleeConn = await connectAndInitClient();
      callee = calleeConn.client;

      const answerPayload = {
        sdp: 'fake-answer-sdp',
        type: 'answer',
      };

      callee.send(
        JSON.stringify({
          type: 'answer',
          target: callerId,
          answer: answerPayload,
        })
      );

      const forwarded = await waitForMessageOfType(caller, 'answer');
      expect(forwarded.answer).toEqual(answerPayload);
      expect(forwarded.sender).toBeDefined();
    } finally {
      terminateClient(caller);
      terminateClient(callee);
    }
  });

  // Send ICE candidate data and check it reaches the target client.
  it('should forward candidate to target peer', async () => {
    let sender;
    let receiver;

    try {
      const senderConn = await connectAndInitClient();
      sender = senderConn.client;
      const senderId = senderConn.init.id;

      const receiverConn = await connectAndInitClient();
      receiver = receiverConn.client;
      const receiverId = receiverConn.init.id;

      const candidatePayload = {
        candidate: 'candidate:1 1 UDP 2122252543 10.0.0.1 3478 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
      };

      sender.send(
        JSON.stringify({
          type: 'candidate',
          target: receiverId,
          candidate: candidatePayload,
        })
      );

      const forwarded = await waitForMessageOfType(receiver, 'candidate');
      expect(forwarded.sender).toBe(senderId);
      expect(forwarded.candidate).toEqual(candidatePayload);
    } finally {
      terminateClient(sender);
      terminateClient(receiver);
    }
  });
});
