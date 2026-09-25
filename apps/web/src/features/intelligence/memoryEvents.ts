/**
 * Fired on window when the assistant writes to a Space's project memory
 * (a remember_fact or correct_fact applied from the chat), so an open memory
 * panel re-reads instead of showing the facts as they were.
 */
export const MEMORY_CHANGED_EVENT = 'assistant:memory-changed'
