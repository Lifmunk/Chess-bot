const BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

async function request(path, { token, method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    throw new Error(data?.detail || "Request failed");
  }
  return data;
}

export function login(password) {
  return request("/auth/login", { method: "POST", body: { password } });
}

export function me(token) {
  return request("/auth/me", { token });
}

export function listTournaments(token, filters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status_filter", filters.status);
  if (filters.q) params.set("q", filters.q);
  return request(`/tournaments${params.toString() ? `?${params}` : ""}`, { token });
}

export function createTournament(token, payload) {
  return request("/tournaments", { token, method: "POST", body: payload });
}

export function startTournament(token, tournamentId) {
  return request(`/tournaments/${tournamentId}/start`, { token, method: "POST" });
}

export function finishTournament(token, tournamentId, payload) {
  return request(`/tournaments/${tournamentId}/finish`, { token, method: "POST", body: payload });
}

export function getTournament(token, tournamentId) {
  return request(`/tournaments/${tournamentId}`, { token });
}

export function getTemplates(token) {
  return request("/templates", { token });
}

export function getLeaderboard(token) {
  return request("/tournaments/leaderboard", { token });
}

export function nuke(token) {
  return request("/nuke", { token, method: "POST" });
}

export function getTest() {
  return request("/test");
}
