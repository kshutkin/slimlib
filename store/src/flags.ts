// ============================================================================
// BIT FLAGS FOR NODE STATE
// ============================================================================
// These flags are central to the push/pull reactive algorithm:
// - PUSH PHASE sets: Flag.CHECK, Flag.DIRTY (propagated eagerly on source change)
// - PULL PHASE checks: Flag.NEEDS_WORK to decide if recomputation is needed
// - PULL PHASE clears: Flag.DIRTY, Flag.CHECK after recomputation
// ============================================================================

// biome-ignore lint/suspicious/noConstEnum: optimization
export const enum Flag {
    // PUSH PHASE: Set when a source definitely changed - forces recomputation
    DIRTY = 1 << 0, // 1 - definitely needs recomputation

    // PUSH PHASE: Set when a source might have changed - needs verification
    CHECK = 1 << 1, // 2 - might need recomputation, check sources first

    // PULL PHASE: Set while executing getter to detect cycles
    COMPUTING = 1 << 2, // 4 - currently executing

    // Determines if node receives PUSH notifications (effects always do)
    EFFECT = 1 << 3, // 8 - is an effect (eager execution, always live)

    // PULL PHASE: Indicates cached value is available
    HAS_VALUE = 1 << 4, // 16 - has a cached value

    // PULL PHASE: Indicates cached error is available
    HAS_ERROR = 1 << 5, // 32 - has a cached error (per TC39 Signals proposal)

    // PUSH PHASE: When set, node receives push notifications from sources
    LIVE = 1 << 6, // 64 - computed is live (has live dependents)

    // PULL PHASE: Has at least one state/signal source (requires polling, can't skip loop)
    HAS_STATE_SOURCE = 1 << 7, // 128 - has state/signal dependency

    // Pre-combined flags for faster checks
    // PULL PHASE: Check if any work is needed before returning cached value
    NEEDS_WORK = DIRTY | CHECK, // 3 - needs recomputation

    // PUSH PHASE: Detect if effect is currently computing (for special handling)
    COMPUTING_EFFECT = COMPUTING | EFFECT, // 12 - computing effect

    // PULL PHASE: For checking if only CHECK is set (not DIRTY or EFFECT)
    CHECK_ONLY = CHECK | DIRTY | EFFECT, // 11 - for checking if only CHECK is set

    // PUSH PHASE: Determines if node participates in push notifications
    LIVE_EFFECT = EFFECT | LIVE, // 72 - either an effect or live computed

    // PUSH PHASE: Skip notification when node is already computing or marked for work
    SKIP_NOTIFY = COMPUTING | NEEDS_WORK, // 7 - already processing

    // PULL PHASE: Combined mask for checking CHECK-only without state sources
    // Used to optimize: (flags & NEEDS_WORK) === CHECK && !(flags & HAS_STATE_SOURCE)
    // Into single check: (flags & CHECK_PURE_MASK) === CHECK
    CHECK_PURE_MASK = NEEDS_WORK | HAS_STATE_SOURCE, // 131 - mask for pure CHECK verification
}
