/** Version 1 structured result commands. Legacy IPC is intentionally untouched. */
import { generateUuid } from "../../core/uid.js";
import { RESULT_LIMITS, RESULT_OPERATIONS, requireResult } from "../results/result-contract.js";
import { captureResultTarget, getResultDocumentInfo } from "../results/result-targets.js";
import { commitExactResult, prepareExactResult } from "../trackers/exact-result-tracker.js";

const frames = new WeakMap();
const observers = new WeakMap();
const COMMANDS = ["getCapabilities", "getDocumentInfo", "prepareResultTarget", ...RESULT_OPERATIONS];

/** Registered by the host at creation; a DOM attribute alone never grants writes. */
export function registerPluginResultFrame(frame) {
  const registration = { session: null };
  frames.set(frame, registration);
  const revoke = () => { registration.session = null; };
  frame.addEventListener("load", revoke);
  if (typeof MutationObserver !== "undefined" && !observers.has(frame.ownerDocument)) {
    const observer = new MutationObserver((records) => {
      for (const record of records) for (const node of record.removedNodes) {
        const removedFrames = [node, ...Array.from(node.querySelectorAll?.("iframe") ?? [])];
        for (const removed of removedFrames) {
          const entry = frames.get(removed);
          if (entry) entry.session = null;
        }
      }
    });
    observer.observe(frame.ownerDocument, { childList: true, subtree: true });
    observers.set(frame.ownerDocument, observer);
  }
}

export function handlePluginResultCommand(controller, message, frame) {
  if (!COMMANDS.includes(message.cmd)) return null;
  const registration = frames.get(frame);
  requireResult(registration, "Plugin frame is not registered for result transactions");
  if (message.cmd === "getCapabilities") {
    requireResult(message.apiVersion === undefined || message.apiVersion === 1, "Unsupported plugin API version");
    if (!registration.session) registration.session = { id: generateUuid(), sequence: 0, target: null };
    return {
      cmd: "capabilities", apiVersion: 1, sessionId: registration.session.id,
      operations: RESULT_OPERATIONS.slice(), pixelFormats: ["rgba8", "coverage8"],
      limits: { ...RESULT_LIMITS }, nextSequence: registration.session.sequence + 1,
    };
  }
  const session = registration.session;
  requireResult(message.apiVersion === 1, "Unsupported plugin API version");
  requireResult(session && message.sessionId === session.id, "Wrong or expired plugin session");
  requireResult(typeof message.requestId === "string" && message.requestId.length > 0 && message.requestId.length <= 128, "Invalid request ID");
  requireResult(Number.isSafeInteger(message.sequence) && message.sequence === session.sequence + 1, "Replayed or out-of-order request");
  // Consume validated sequence even on an operation error; retries need a new
  // sequence. A counter bounds replay bookkeeping without an ever-growing set.
  session.sequence = message.sequence;
  if (message.cmd === "getDocumentInfo") return { cmd: "documentInfo", apiVersion: 1, ...getResultDocumentInfo(controller.getCurrentDoc()) };
  if (message.cmd === "prepareResultTarget") {
    session.target = null;
    const target = captureResultTarget(controller, message);
    session.target = { id: generateUuid(), target };
    return { cmd: "resultTarget", targetToken: session.target.id, documentId: target.documentId, operation: target.operation };
  }
  const pending = session.target;
  session.target = null;
  requireResult(pending && pending.id === message.targetToken && pending.target.documentId === message.documentId && pending.target.operation === message.cmd, "Wrong, stale or consumed result target");
  const prepared = prepareExactResult(controller, pending.target, message.payload);
  const result = commitExactResult(controller, prepared);
  // A chrome refresh failure must not turn an already committed edit into an
  // error reply (which could encourage the plugin to submit it again).
  try { controller.onComplete?.(); } catch (error) { console.error("Result committed; UI refresh failed", error); }
  return { cmd: "resultCommitted", ...result };
}
