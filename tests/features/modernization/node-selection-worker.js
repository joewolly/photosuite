import { parentPort } from 'node:worker_threads';
globalThis.self = { postMessage: (message, transfer) => parentPort.postMessage(message, transfer) };
await import('../../../src/features/modernization/quick-select-worker.js');
parentPort.on('message', (data) => self.onmessage({ data }));
