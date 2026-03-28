/**
 * Auth API Client
 *
 * Handles communication with the backend authentication Lambda.
 */

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

async function request(path: string, body: any) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }
  return data;
}

export const authApi = {
  async register(email: string, password: string, name: string) {
    return request("/auth/register", { email, password, name });
  },

  async confirm(email: string, code: string) {
    return request("/auth/confirm", { email, code });
  },

  async login(email: string, password: string) {
    const tokens = await request("/auth/login", { email, password });
    // Store tokens in localStorage for persistence
    localStorage.setItem("cc_access_token", tokens.accessToken);
    localStorage.setItem("cc_id_token", tokens.idToken);
    localStorage.setItem("cc_refresh_token", tokens.refreshToken);
    return tokens;
  },

  async forgotPassword(email: string) {
    return request("/auth/forgot-password", { email });
  },

  async confirmPassword(email: string, code: string, password: string) {
    return request("/auth/confirm-password", { email, code, password });
  },

  async confirmMfa(email: string, code: string, session: string) {
    const tokens = await request("/auth/confirm-mfa", { email, code, session });
    localStorage.setItem("cc_access_token", tokens.accessToken);
    localStorage.setItem("cc_id_token", tokens.idToken);
    localStorage.setItem("cc_refresh_token", tokens.refreshToken);
    return tokens;
  },

  async logout() {
    localStorage.removeItem("cc_access_token");
    localStorage.removeItem("cc_id_token");
    localStorage.removeItem("cc_refresh_token");
  },

  getAccessToken() {
    return localStorage.getItem("cc_access_token");
  }
};
