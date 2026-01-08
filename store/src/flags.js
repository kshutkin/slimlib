// Bit flags for node state
export const FLAG_DIRTY = 1 << 0; // 1 - definitely needs recomputation
export const FLAG_CHECK = 1 << 1; // 2 - might need recomputation, check sources first
export const FLAG_COMPUTING = 1 << 2; // 4 - currently executing
export const FLAG_EFFECT = 1 << 3; // 8 - is an effect (eager execution, always live)
export const FLAG_HAS_VALUE = 1 << 4; // 16 - has a cached value
export const FLAG_HAS_ERROR = 1 << 5; // 32 - has a cached error (per TC39 Signals proposal)
export const FLAG_LIVE = 1 << 6; // 64 - computed is live (has live dependents)

// Pre-combined flags for faster checks
export const FLAG_NEEDS_WORK = FLAG_DIRTY | FLAG_CHECK; // 3 - needs recomputation
export const FLAG_COMPUTING_EFFECT = FLAG_COMPUTING | FLAG_EFFECT; // 12 - computing effect
export const FLAG_CHECK_ONLY = FLAG_CHECK | FLAG_DIRTY | FLAG_EFFECT; // 11 - for checking if only CHECK is set
export const FLAG_IS_LIVE = FLAG_EFFECT | FLAG_LIVE; // 72 - either an effect or live computed
