import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  createTournament,
  finishTournament,
  getTournament,
  getTemplates,
  listTournaments,
  login,
  me,
  nuke,
  startTournament,
  getTest,
} from "./api";

const emptyForm = {
  name: "",
  chesscom_link: "",
  format: "Swiss",
  rated: true,
  scheduled_date: "",
  scheduled_time: "",
  notes: "",
  is_automated: false,
  recurrence: "",
};

const emptyResultForm = {
  winner: "",
  runner_up: "",
  third_place: "",
};

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";
  return date.toLocaleString();
}

function formatSchedulePreview(dateValue, timeValue) {
  if (!dateValue || !timeValue) return "No schedule set";
  const scheduled = new Date(`${dateValue}T${timeValue}`);
  if (Number.isNaN(scheduled.getTime())) return "Invalid schedule";
  return scheduled.toLocaleString();
}

function App() {
  const [token, setToken] = useState(localStorage.getItem("chessclub_token") || "");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [tournaments, setTournaments] = useState([]);
  const [messageTemplates, setMessageTemplates] = useState(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [resultForm, setResultForm] = useState(emptyResultForm);
  const [selectedId, setSelectedId] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [toasts, setToasts] = useState([]);

  const deferredQuery = useDeferredValue(query.trim());

  const selectedTournament = useMemo(
    () => tournaments.find((item) => item.tournament_id === selectedId) || null,
    [selectedId, tournaments]
  );

  const stats = useMemo(() => {
    const planned = tournaments.filter((item) => item.status === "planned").length;
    const started = tournaments.filter((item) => item.status === "started").length;
    const finished = tournaments.filter((item) => item.status === "finished").length;

    return {
      total: tournaments.length,
      planned,
      started,
      finished,
    };
  }, [tournaments]);

  const scheduledPreview = useMemo(
    () => formatSchedulePreview(form.scheduled_date, form.scheduled_time),
    [form.scheduled_date, form.scheduled_time]
  );

  function notify(message, type = "success") {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 3500);
  }

  async function fetchTournaments(nextQuery = deferredQuery, nextStatus = statusFilter) {
    if (!token || !user) return;
    setListLoading(true);
    try {
      const data = await listTournaments(token, { q: nextQuery, status: nextStatus });
      setTournaments(data.items || []);
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setListLoading(false);
    }
  }

  useEffect(() => {
    if (!token) {
      setAuthLoading(false);
      setUser(null);
      setTournaments([]);
      setSelectedId("");
      return;
    }

    let cancelled = false;

    (async () => {
      setAuthLoading(true);
      try {
        const profile = await me(token);
        if (cancelled) return;
        setUser(profile);
      } catch {
        if (cancelled) return;
        localStorage.removeItem("chessclub_token");
        setToken("");
        setUser(null);
        setTournaments([]);
        setSelectedId("");
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!token || !user) return;
    let cancelled = false;

    (async () => {
      setListLoading(true);
      try {
        const data = await listTournaments(token, { q: deferredQuery, status: statusFilter });
        if (cancelled) return;
        setTournaments(data.items || []);
      } catch (err) {
        if (!cancelled) notify(err.message, "error");
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, user, deferredQuery, statusFilter]);

  useEffect(() => {
    if (!token || !user) return;
    let cancelled = false;

    (async () => {
      try {
        const data = await getTemplates(token);
        if (!cancelled) setMessageTemplates(data);
      } catch (err) {
        if (!cancelled) notify(err.message, "error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, user]);

  useEffect(() => {
    if (!tournaments.length) {
      if (selectedId) setSelectedId("");
      return;
    }

    const hasSelection = tournaments.some((item) => item.tournament_id === selectedId);
    if (!hasSelection) {
      setSelectedId(tournaments[0].tournament_id);
    }
  }, [selectedId, tournaments]);

  useEffect(() => {
    if (!selectedTournament) return;
    setResultForm({
      winner: selectedTournament.winner || "",
      runner_up: selectedTournament.runner_up || "",
      third_place: selectedTournament.third_place || "",
    });
  }, [selectedTournament]);

  async function handleLogin(event) {
    event.preventDefault();
    setLoginError("");
    setBusyAction("login");
    try {
      const data = await login(password);
      localStorage.setItem("chessclub_token", data.access_token);
      setToken(data.access_token);
      setPassword("");
      notify("Signed in");
    } catch (err) {
      setLoginError(err.message);
      notify("Login failed", "error");
    } finally {
      setBusyAction("");
    }
  }

  async function handleCreate(event) {
    event.preventDefault();
    setBusyAction("create");
    try {
      const scheduled_for =
        form.scheduled_date && form.scheduled_time
          ? new Date(`${form.scheduled_date}T${form.scheduled_time}`).toISOString()
          : null;
      const payload = {
        ...form,
        scheduled_for,
        recurrence: form.recurrence || null,
        notes: form.notes.trim(),
      };
      const created = await createTournament(token, payload);
      setForm(emptyForm);
      setSelectedId(created.tournament_id);
      notify("Tournament created");
      await fetchTournaments();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusyAction("");
    }
  }

  async function handleOpenTournament(tournamentId) {
    setSelectedId(tournamentId);
    try {
      const data = await getTournament(token, tournamentId);
      setResultForm({
        winner: data.winner || "",
        runner_up: data.runner_up || "",
        third_place: data.third_place || "",
      });
    } catch (err) {
      notify(err.message, "error");
    }
  }

  async function handleStart(tournamentId) {
    setBusyAction("start");
    try {
      await startTournament(token, tournamentId);
      notify("Tournament marked as started");
      await fetchTournaments();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusyAction("");
    }
  }

  async function handleFinish(event) {
    event.preventDefault();
    if (!selectedId) return;
    setBusyAction("finish");
    try {
      await finishTournament(token, selectedId, resultForm);
      notify("Results published");
      await fetchTournaments();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusyAction("");
    }
  }

  async function handleNuke() {
    if (!window.confirm("Delete all tournament and user records? This cannot be undone.")) return;
    setBusyAction("nuke");
    try {
      await nuke(token);
      setTournaments([]);
      setSelectedId("");
      setForm(emptyForm);
      setResultForm(emptyResultForm);
      notify("Database cleared", "error");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusyAction("");
    }
  }

  async function handleTest() {
    setBusyAction("test");
    try {
      const data = await getTest();
      notify(data.message);
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusyAction("");
    }
  }

  function handleLogout() {
    localStorage.removeItem("chessclub_token");
    setToken("");
    setUser(null);
    setTournaments([]);
    setSelectedId("");
    setQuery("");
    setStatusFilter("");
    setForm(emptyForm);
    setResultForm(emptyResultForm);
    setMessageTemplates(null);
  }

  const isBusy = Boolean(busyAction);

  if (authLoading) {
    return (
      <div className="app-shell app-shell--centered">
        <div className="loading-card">Loading admin panel...</div>
      </div>
    );
  }

  if (!token || !user) {
    return (
      <div className="app-shell app-shell--centered">
        <section className="auth-card">
          <p className="eyebrow">Chess Club Admin</p>
          <h1>Sign in</h1>
          <p className="muted">
            Use the shared admin password from the backend environment file.
          </p>
          <form className="stack" onSubmit={handleLogin}>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Admin password"
                autoComplete="current-password"
              />
            </label>
            {loginError ? <p className="error-text">{loginError}</p> : null}
            <button className="button button--primary" type="submit" disabled={busyAction === "login"}>
              Sign in
            </button>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Chess Club Admin</p>
          <h1>Simple tournament control panel</h1>
          <p className="muted">
            Signed in as <strong>{user.username}</strong>
          </p>
        </div>
        <div className="topbar-actions">
          <button className="button" type="button" onClick={handleLogout} disabled={isBusy}>
            Sign out
          </button>
        </div>
      </header>

      <section className="stats-grid">
        <article className="stat-card">
          <span>Total</span>
          <strong>{stats.total}</strong>
        </article>
        <article className="stat-card">
          <span>Planned</span>
          <strong>{stats.planned}</strong>
        </article>
        <article className="stat-card">
          <span>Started</span>
          <strong>{stats.started}</strong>
        </article>
        <article className="stat-card">
          <span>Finished</span>
          <strong>{stats.finished}</strong>
        </article>
      </section>

      <div className="layout">
        <aside className="sidebar">
          <section className="card">
            <div className="card-head">
              <div>
                <p className="eyebrow">Create Tournament</p>
                <h2>New entry</h2>
              </div>
            </div>

            <form className="stack" onSubmit={handleCreate}>
              <label className="field">
                <span>Name</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Weekly Swiss"
                />
              </label>

              <label className="field">
                <span>Chess.com link</span>
                <input
                  value={form.chesscom_link}
                  onChange={(e) => setForm({ ...form, chesscom_link: e.target.value })}
                  placeholder="https://www.chess.com/tournament/..."
                />
              </label>

              <div className="form-row">
                <label className="field">
                  <span>Format</span>
                  <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}>
                    <option value="Swiss">Swiss</option>
                    <option value="Arena">Arena</option>
                    <option value="Rapid">Rapid</option>
                    <option value="Blitz">Blitz</option>
                  </select>
                </label>

                <label className="field field--inline">
                  <span>Rated</span>
                  <div className="toggle-row">
                    <input
                      type="checkbox"
                      checked={form.rated}
                      onChange={(e) => setForm({ ...form, rated: e.target.checked })}
                    />
                    <span>{form.rated ? "Yes" : "No"}</span>
                  </div>
                </label>
              </div>

              <div className="form-row">
                <label className="field">
                  <span>Calendar date</span>
                  <input
                    type="date"
                    value={form.scheduled_date}
                    onChange={(e) => setForm({ ...form, scheduled_date: e.target.value })}
                  />
                </label>

                <label className="field">
                  <span>Time</span>
                  <input
                    type="time"
                    value={form.scheduled_time}
                    onChange={(e) => setForm({ ...form, scheduled_time: e.target.value })}
                  />
                </label>
              </div>

              <div className="schedule-preview">
                <span>Scheduled start</span>
                <strong>{scheduledPreview}</strong>
              </div>

              <div className="form-row">
                <label className="field">
                  <span>Recurrence</span>
                  <select value={form.recurrence} onChange={(e) => setForm({ ...form, recurrence: e.target.value })}>
                    <option value="">None</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
              </div>

              <label className="field field--inline">
                <span>Automate start</span>
                <div className="toggle-row">
                  <input
                    type="checkbox"
                    checked={form.is_automated}
                    onChange={(e) => setForm({ ...form, is_automated: e.target.checked })}
                  />
                  <span>{form.is_automated ? "On" : "Off"}</span>
                </div>
              </label>

              <label className="field">
                <span>Notes</span>
                <textarea
                  rows="4"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Optional moderator notes"
                />
              </label>

              <button
                className="button button--primary"
                type="submit"
                disabled={isBusy || !form.name.trim() || !form.chesscom_link.trim()}
              >
                Schedule
              </button>
            </form>
          </section>

          <section className="card card--danger">
            <div>
              <p className="eyebrow">Danger Zone</p>
              <h2>Reset database</h2>
            </div>
            <p className="muted">
              Removes all tournaments and linked users, then recreates the database tables.
            </p>
            <button className="button button--danger" type="button" onClick={handleNuke} disabled={isBusy}>
              Delete all records
            </button>
          </section>

          <section className="card">
            <div>
              <p className="eyebrow">System</p>
              <h2>Options</h2>
            </div>
            <div className="stack">
              <button className="button" type="button" onClick={() => fetchTournaments()} disabled={isBusy}>
                Refresh Data
              </button>
              <button className="button" type="button" onClick={handleTest} disabled={isBusy}>
                Test API Connection
              </button>
            </div>
          </section>

          {messageTemplates ? (
            <section className="card">
              <div className="card-head">
                <div>
                  <p className="eyebrow">Posting templates</p>
                  <h2>Predefined messages</h2>
                </div>
              </div>
              <div className="template-list">
                {Object.entries(messageTemplates).map(([key, lines]) => (
                  <div className="template-block" key={key}>
                    <strong>{key}</strong>
                    <ul>
                      {lines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </aside>

        <main className="content">
          <section className="card">
            <div className="toolbar">
              <div>
                <p className="eyebrow">Library</p>
                <h2>Tournaments</h2>
              </div>
              <div className="toolbar-actions">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name, ID, or link"
                />
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All statuses</option>
                  <option value="planned">Planned</option>
                  <option value="started">Started</option>
                  <option value="finished">Finished</option>
                </select>
              </div>
            </div>

            <div className="list">
              {listLoading ? <div className="empty-state">Loading tournaments...</div> : null}
              {!listLoading && tournaments.length === 0 ? (
                <div className="empty-state">No tournaments match the current filters.</div>
              ) : null}

              {tournaments.map((item) => (
                <button
                  key={item.tournament_id}
                  type="button"
                  className={`list-item ${item.tournament_id === selectedId ? "is-active" : ""}`}
                  onClick={() => handleOpenTournament(item.tournament_id)}
                >
                  <div className="list-item__main">
                    <strong>{item.name}</strong>
                    <span>{item.tournament_id}</span>
                  </div>
                  <div className="list-item__meta">
                    <span className={`chip chip--${item.status}`}>{item.status}</span>
                    <span className="muted">{formatDate(item.scheduled_for)}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <p className="eyebrow">Details</p>
                <h2>{selectedTournament ? selectedTournament.name : "Select a tournament"}</h2>
              </div>
              {selectedTournament ? (
                <span className={`chip chip--${selectedTournament.status}`}>{selectedTournament.status}</span>
              ) : null}
            </div>

            {selectedTournament ? (
              <div className="detail">
                <div className="detail-grid">
                  <div className="detail-item">
                    <span>ID</span>
                    <strong>{selectedTournament.tournament_id}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Format</span>
                    <strong>{selectedTournament.format}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Rated</span>
                    <strong>{selectedTournament.rated ? "Yes" : "No"}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Automation</span>
                    <strong>{selectedTournament.is_automated ? "On" : "Off"}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Scheduled</span>
                    <strong>{formatDate(selectedTournament.scheduled_for)}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Created</span>
                    <strong>{formatDate(selectedTournament.created_at)}</strong>
                  </div>
                </div>

                <div className="detail-links">
                  <a href={selectedTournament.chesscom_link} target="_blank" rel="noreferrer">
                    Open Chess.com link
                  </a>
                </div>

                {selectedTournament.notes ? (
                  <div className="note-box">
                    <span>Notes</span>
                    <p>{selectedTournament.notes}</p>
                  </div>
                ) : null}

                <div className="detail-actions">
                  {selectedTournament.status === "planned" ? (
                    <button
                      className="button button--primary"
                      type="button"
                      onClick={() => handleStart(selectedTournament.tournament_id)}
                      disabled={isBusy}
                    >
                      Start now
                    </button>
                  ) : null}
                </div>

                {selectedTournament.status !== "finished" ? (
                  <form className="card card--soft stack" onSubmit={handleFinish}>
                    <div>
                      <p className="eyebrow">Results</p>
                      <h3>Publish winners</h3>
                    </div>

                    <label className="field">
                      <span>Winner</span>
                      <input
                        value={resultForm.winner}
                        onChange={(e) => setResultForm({ ...resultForm, winner: e.target.value })}
                        placeholder="Chess.com username"
                      />
                    </label>

                    <label className="field">
                      <span>Runner-up</span>
                      <input
                        value={resultForm.runner_up}
                        onChange={(e) => setResultForm({ ...resultForm, runner_up: e.target.value })}
                        placeholder="Chess.com username"
                      />
                    </label>

                    <label className="field">
                      <span>Third place</span>
                      <input
                        value={resultForm.third_place}
                        onChange={(e) => setResultForm({ ...resultForm, third_place: e.target.value })}
                        placeholder="Chess.com username"
                      />
                    </label>

                    <button
                      className="button button--primary"
                      type="submit"
                      disabled={isBusy || !resultForm.winner.trim()}
                    >
                      Submit results
                    </button>
                  </form>
                ) : (
                  <div className="empty-state">This tournament is finished.</div>
                )}
              </div>
            ) : (
              <div className="empty-state">Pick a tournament to manage its status and results.</div>
            )}
          </section>
        </main>
      </div>

      <div className="toast-stack" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.type}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
