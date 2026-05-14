const ENV = import.meta.env.VITE_APP_ENV || "local";
const DEFAULT_LOCAL_URL = "http://localhost:8000";
const PRODUCTION_URL = "https://chess-bot-uflt.onrender.com";

const BASE_URL = (import.meta.env.VITE_API_BASE_URL || (ENV === "deployment" ? PRODUCTION_URL : DEFAULT_LOCAL_URL)).replace(/\/$/, "");

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
    let errorMessage = "Request failed";
    if (data?.detail) {
      if (typeof data.detail === "string") {
        errorMessage = data.detail;
      } else if (Array.isArray(data.detail)) {
        errorMessage = data.detail.map(e => (e.msg || "Unknown error") + (e.loc ? ` (${e.loc.join(".")})` : "")).join(", ");
      } else {
        errorMessage = JSON.stringify(data.detail);
      }
    }
    throw new Error(errorMessage);
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

export function updateTournament(token, tournamentId, payload) {
  return request(`/tournaments/${tournamentId}`, { token, method: "PATCH", body: payload });
}

export function deleteTournament(token, tournamentId) {
  return request(`/tournaments/${tournamentId}`, { token, method: "DELETE" });
}

export function startTournament(token, tournamentId) {
  return request(`/tournaments/${tournamentId}/start`, { token, method: "POST" });
}

export function finishTournament(token, tournamentId, payload) {
  return request(`/tournaments/${tournamentId}/finish`, { token, method: "POST", body: payload });
}

export function getTournament(token, tournament_id) {
  return request(`/tournaments/${tournament_id}`, { token });
}

export function fetchTournamentInfo(token, url) {
  return request(`/tournaments/fetch?url=${encodeURIComponent(url)}`, { token });
}

export function getUsers(token) {

  return request("/users", { token });
}

export function linkUser(token, payload) {
  return request("/users/link", { token, method: "POST", body: payload });
}

export function unlinkUser(token, discordId) {
  return request(`/users/${discordId}`, { token, method: "DELETE" });
}

export function announce(token, payload) {
  return request("/announce", { token, method: "POST", body: payload });
}

export function listAnnouncements(token, filters = {}) {
  const params = new URLSearchParams();
  if (filters.sent !== undefined) params.set("sent", filters.sent);
  return request(`/announcements${params.toString() ? `?${params}` : ""}`, { token });
}

export function scheduleAnnouncement(token, payload) {
  return request("/announcements", { token, method: "POST", body: payload });
}

export function updateAnnouncement(token, id, payload) {
  return request(`/announcements/${id}`, { token, method: "PATCH", body: payload });
}

export function deleteAnnouncement(token, id) {
  return request(`/announcements/${id}`, { token, method: "DELETE" });
}

export function sendAnnouncementNow(token, id) {
  return request(`/announcements/${id}/send`, { token, method: "POST" });
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

export function getSettings(token) {
  return request("/settings", { token });
}

export function updateSettings(token, payload) {
  return request("/settings", { token, method: "POST", body: payload });
}

export function getDiscordChannels(token) {
  return request("/discord/channels", { token });
}

export function getTest() {
  return request("/test");
}
