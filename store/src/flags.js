// ============================================================================
// BIT FLAGS FOR NODE STATE
// ============================================================================
// These flags are central to the push/pull reactive algorithm:
// - PUSH PHASE sets: FLAG_CHECK, FLAG_DIRTY (propagated eagerly on source change)
// - PULL PHASE checks: FLAG_NEEDS_WORK to decide if recomputation is needed
// - PULL PHASE clears: FLAG_DIRTY, FLAG_CHECK after recomputation
// ============================================================================

// PUSH PHASE: Set when a source definitely changed - forces recomputation
export const FLAG_DIRTY = 1 << 0; // 1 - definitely needs recomputation

// PUSH PHASE: Set when a source might have changed - needs verification
export const FLAG_CHECK = 1 << 1; // 2 - might need recomputation, check sources first

// PULL PHASE: Set while executing getter to detect cycles
export const FLAG_COMPUTING = 1 << 2; // 4 - currently executing

// Determines if node receives PUSH notifications (effects always do)
export const FLAG_EFFECT = 1 << 3; // 8 - is an effect (eager execution, always live)

// PULL PHASE: Indicates cached value is available
export const FLAG_HAS_VALUE = 1 << 4; // 16 - has a cached value

// PULL PHASE: Indicates cached error is available
export const FLAG_HAS_ERROR = 1 << 5; // 32 - has a cached error (per TC39 Signals proposal)

// PUSH PHASE: When set, node receives push notifications from sources
export const FLAG_LIVE = 1 << 6; // 64 - computed is live (has live dependents)

// Pre-combined flags for faster checks
// PULL PHASE: Check if any work is needed before returning cached value
export const FLAG_NEEDS_WORK = FLAG_DIRTY | FLAG_CHECK; // 3 - needs recomputation

// PUSH PHASE: Detect if effect is currently computing (for special handling)
export const FLAG_COMPUTING_EFFECT = FLAG_COMPUTING | FLAG_EFFECT; // 12 - computing effect

// PULL PHASE: For checking if only CHECK is set (not DIRTY or EFFECT)
export const FLAG_CHECK_ONLY = FLAG_CHECK | FLAG_DIRTY | FLAG_EFFECT; // 11 - for checking if only CHECK is set

// PUSH PHASE: Determines if node participates in push notifications
export const FLAG_IS_LIVE = FLAG_EFFECT | FLAG_LIVE; // 72 - either an effect or live computed

// PUSH PHASE: Skip notification when node is already computing or marked for work
export const FLAG_SKIP_NOTIFY = FLAG_COMPUTING | FLAG_NEEDS_WORK; // 7 - already processing

// PULL PHASE: Has at least one state/signal source (requires polling, can't skip loop)
export const FLAG_HAS_STATE_SOURCE = 1 << 7; // 128 - has state/signal dependency
