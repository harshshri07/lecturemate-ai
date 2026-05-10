/**
 * Session management:
 * - Chat history stored in sessionStorage (cleared when browser closes)
 * - Rate limiting: 1 URL per day for guests, 5 URLs per day for signed-in users
 */

const GUEST_CHAT_KEY = "lecturemate_guest_chat";
const GUEST_RATE_LIMIT_KEY = "lecturemate_guest_rate_limit";
const SIGNED_IN_RATE_LIMIT_KEY = "lecturemate_signed_in_rate_limit";

export interface GuestChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface RateLimitEntry {
  url: string;
  timestamp: number;
}

/**
 * Get chat history from sessionStorage (persists during browser session)
 */
export function getGuestChatHistory(): GuestChatMessage[] {
  try {
    let data = sessionStorage.getItem(GUEST_CHAT_KEY);
    if (!data) {
      const legacy = sessionStorage.getItem("studyai_guest_chat");
      if (legacy) {
        sessionStorage.setItem(GUEST_CHAT_KEY, legacy);
        data = legacy;
      }
    }
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * Save chat message to sessionStorage
 */
export function saveGuestChatMessage(message: GuestChatMessage): void {
  try {
    const history = getGuestChatHistory();
    history.push(message);
    sessionStorage.setItem(GUEST_CHAT_KEY, JSON.stringify(history));
  } catch {
    // Ignore errors
  }
}

/**
 * Clear chat history (when user signs out or closes browser)
 */
export function clearGuestChatHistory(): void {
  try {
    sessionStorage.removeItem(GUEST_CHAT_KEY);
  } catch {
    // Ignore errors
  }
}

/**
 * Check if guest can use a URL (server-side IP-based rate limiting)
 * Returns { allowed: boolean, remaining: number, warning: boolean }
 */
export async function canGuestUseUrl(): Promise<{ allowed: boolean; remaining: number; warning: boolean }> {
  try {
    const response = await fetch("/api/rate-limit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "check" }),
    });

    if (!response.ok) {
      return { allowed: true, remaining: 1, warning: false }; // Allow on error
    }

    const data = await response.json();
    const remaining = data.remaining;
    const warning = remaining <= 0; // Warn when no URLs left

    return {
      allowed: data.allowed,
      remaining,
      warning,
    };
  } catch {
    return { allowed: true, remaining: 1, warning: false }; // Allow on error
  }
}

/**
 * Increment guest URL count (server-side IP-based)
 */
export async function incrementGuestUrlCount(): Promise<void> {
  try {
    await fetch("/api/rate-limit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "increment" }),
    });
  } catch {
    // Ignore errors
  }
}

/**
 * Check if signed-in user can use a URL (localStorage-based, 5 per day)
 */
export function canUseUrl(url: string, isSignedIn: boolean): { allowed: boolean; remaining: number; warning: boolean } {
  if (!isSignedIn) {
    // Should use canGuestUseUrl instead
    return { allowed: true, remaining: 1, warning: false };
  }

  const limit = 5;
  const key = SIGNED_IN_RATE_LIMIT_KEY;

  try {
    let data = localStorage.getItem(key);
    if (!data) {
      const legacy = localStorage.getItem("studyai_signed_in_rate_limit");
      if (legacy) {
        localStorage.setItem(key, legacy);
        data = legacy;
      }
    }
    const entries: RateLimitEntry[] = data ? JSON.parse(data) : [];

    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    // Remove entries older than 24 hours
    const recentEntries = entries.filter(e => now - e.timestamp < oneDayMs);

    // Check if this URL was already used today
    const urlUsedToday = recentEntries.some(e => e.url === url);

    if (urlUsedToday) {
      return { allowed: false, remaining: Math.max(0, limit - recentEntries.length), warning: false };
    }

    // Check if at limit
    if (recentEntries.length >= limit) {
      return { allowed: false, remaining: 0, warning: false };
    }

    // Add this URL to the rate limit log
    recentEntries.push({ url, timestamp: now });
    localStorage.setItem(key, JSON.stringify(recentEntries));

    const remaining = Math.max(0, limit - recentEntries.length);
    const warning = remaining <= 2; // Warn when 2 or fewer left

    return { allowed: true, remaining, warning };
  } catch {
    return { allowed: true, remaining: limit, warning: false }; // Allow on error
  }
}
