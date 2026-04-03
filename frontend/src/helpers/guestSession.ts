/**
 * Guest Session Manager
 * 
 * Manages a persistent session ID for unauthenticated users to 
 * track scans before they create an account.
 */

const GUEST_SESSION_KEY = "cc_guest_session_id";

export const guestSession = {
  /** Retrieves existing sessionId or creates a new one */
  getOrCreate: (): string => {
    let id = localStorage.getItem(GUEST_SESSION_KEY);
    if (!id) {
      // Use crypto.randomUUID if available, or fallback to simple timestamp-based ID
      id = (typeof crypto.randomUUID === 'function') 
        ? crypto.randomUUID() 
        : `guest-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      localStorage.setItem(GUEST_SESSION_KEY, id);
    }
    return id;
  },

  /** Clears the session after data has been claimed */
  clear: () => {
    localStorage.removeItem(GUEST_SESSION_KEY);
  },

  /** Checks if a guest session exists */
  exists: (): boolean => {
    return !!localStorage.getItem(GUEST_SESSION_KEY);
  }
};
