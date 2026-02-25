/**
 * Regression tests for AG-UI event handlers
 *
 * These tests verify that message timestamps are captured at event processing
 * time rather than being left empty for render-time computation.
 *
 * Bug: Message timestamps kept changing to the current time on every React
 * re-render because they were stored as empty strings, triggering a fallback
 * that computed new Date() at render time.
 *
 * Fix: Replace `String(event.timestamp ?? '')` with `new Date(event.timestamp ?? Date.now()).toISOString()`
 * so timestamps are captured in ISO format when events are processed.
 *
 * To run: npm test (after adding vitest to devDependencies)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processAGUIEvent } from '../event-handlers'
import { EventType } from '@/types/agui'
import type { AGUIClientState } from '../types'
import type { EventHandlerCallbacks } from '../event-handlers'

// Mock initial state
function createInitialState(): AGUIClientState {
  return {
    status: 'idle',
    threadId: null,
    runId: null,
    messages: [],
    currentMessage: null,
    currentToolCall: null,
    pendingToolCalls: new Map(),
    pendingChildren: new Map(),
    currentReasoning: null,
    currentThinking: null,
    state: {},
    activities: [],
    error: null,
    messageFeedback: new Map(),
  }
}

// Mock callbacks
function createCallbacks(): EventHandlerCallbacks {
  return {
    onMessage: vi.fn(),
    onError: vi.fn(),
    onTraceId: vi.fn(),
    setIsRunActive: vi.fn(),
    currentRunIdRef: { current: null },
    hiddenMessageIdsRef: { current: new Set() },
  }
}

describe('event-handlers timestamp capture', () => {
  let state: AGUIClientState
  let callbacks: EventHandlerCallbacks

  beforeEach(() => {
    state = createInitialState()
    callbacks = createCallbacks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('TEXT_MESSAGE_START', () => {
    it('should capture timestamp in ISO format, not leave it empty', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      const event = {
        type: EventType.TEXT_MESSAGE_START,
        messageId: 'msg-1',
        role: 'assistant' as const,
        // Event has no timestamp (simulating runner not setting it)
      }

      const newState = processAGUIEvent(state, event as any, callbacks)

      // The timestamp should be captured as ISO string (parseable by formatTimestamp)
      expect(newState.currentMessage?.timestamp).toBeDefined()
      expect(newState.currentMessage?.timestamp).not.toBe('')
      // Should be ISO format like "2024-02-25T12:34:56.789Z"
      expect(newState.currentMessage?.timestamp).toBe(new Date(now).toISOString())
      // Verify it's parseable
      expect(new Date(newState.currentMessage!.timestamp!).getTime()).toBe(now)
    })

    it('should convert event timestamp (epoch ms) to ISO format', () => {
      const eventTimestamp = 1234567890000 // epoch milliseconds
      const event = {
        type: EventType.TEXT_MESSAGE_START,
        messageId: 'msg-1',
        role: 'assistant' as const,
        timestamp: eventTimestamp,
      }

      const newState = processAGUIEvent(state, event as any, callbacks)

      // Should be converted to ISO format
      expect(newState.currentMessage?.timestamp).toBe(new Date(eventTimestamp).toISOString())
      // Verify it's parseable back to the original time
      expect(new Date(newState.currentMessage!.timestamp!).getTime()).toBe(eventTimestamp)
    })
  })

  describe('TEXT_MESSAGE_END', () => {
    it('should capture timestamp when finalizing message without event timestamp', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      // Start with a message in progress
      state.currentMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: 'Hello world',
        timestamp: String(now - 1000), // Started 1 second ago
      }

      const event = {
        type: EventType.TEXT_MESSAGE_END,
        messageId: 'msg-1',
        // No timestamp from runner
      }

      const newState = processAGUIEvent(state, event as any, callbacks)

      // Message should be added with a proper timestamp
      expect(newState.messages.length).toBe(1)
      expect(newState.messages[0].timestamp).toBeDefined()
      expect(newState.messages[0].timestamp).not.toBe('')
    })
  })

  describe('TOOL_CALL_START', () => {
    it('should capture timestamp in ISO format for pending tool calls', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      const event = {
        type: EventType.TOOL_CALL_START,
        toolCallId: 'tool-1',
        toolCallName: 'search',
        // No timestamp
      }

      const newState = processAGUIEvent(state, event as any, callbacks)

      const pendingTool = newState.pendingToolCalls.get('tool-1')
      expect(pendingTool?.timestamp).toBeDefined()
      expect(pendingTool?.timestamp).not.toBe('')
      // Should be ISO format
      expect(pendingTool?.timestamp).toBe(new Date(now).toISOString())
    })
  })

  describe('Timestamp stability regression test', () => {
    /**
     * This is the core regression test for the bug.
     *
     * The bug was: timestamps stored as empty string '' caused render-time
     * fallback to new Date(), making timestamps constantly change.
     *
     * The fix ensures timestamps are captured at processing time and
     * remain stable across multiple state accesses.
     */
    it('timestamps should remain stable across multiple accesses', () => {
      const initialTime = Date.now()
      vi.setSystemTime(initialTime)

      // Process a message start event
      const startEvent = {
        type: EventType.TEXT_MESSAGE_START,
        messageId: 'msg-1',
        role: 'assistant' as const,
      }
      let newState = processAGUIEvent(state, startEvent as any, callbacks)
      const capturedTimestamp = newState.currentMessage?.timestamp

      // Advance time significantly
      vi.advanceTimersByTime(10000) // 10 seconds later

      // Access timestamp again - it should NOT have changed
      expect(newState.currentMessage?.timestamp).toBe(capturedTimestamp)

      // Complete the message
      newState.currentMessage = {
        ...newState.currentMessage!,
        content: 'Test content',
      }
      const endEvent = {
        type: EventType.TEXT_MESSAGE_END,
        messageId: 'msg-1',
      }

      // Advance time again
      vi.advanceTimersByTime(5000)

      newState = processAGUIEvent(newState, endEvent as any, callbacks)

      // The stored message's timestamp should be stable
      const storedTimestamp = newState.messages[0]?.timestamp
      expect(storedTimestamp).toBeDefined()
      expect(storedTimestamp).not.toBe('')

      // Advance time more and verify stability
      vi.advanceTimersByTime(60000)
      expect(newState.messages[0]?.timestamp).toBe(storedTimestamp)
    })

    it('timestamps should be parseable by Date constructor (required for formatTimestamp)', () => {
      const now = Date.now()
      vi.setSystemTime(now)

      const event = {
        type: EventType.TEXT_MESSAGE_START,
        messageId: 'msg-1',
        role: 'assistant' as const,
      }

      const newState = processAGUIEvent(state, event as any, callbacks)
      const timestamp = newState.currentMessage?.timestamp

      // The timestamp must be parseable - this is what formatTimestamp() does
      const parsed = new Date(timestamp!)
      expect(parsed.getTime()).not.toBeNaN()
      expect(parsed.getTime()).toBe(now)
    })
  })
})
