import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  createTournament,
  finishTournament,
  getTournament,
  getLeaderboard,
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

function App() {
  const [token, setToken] = useState(localStorage.getItem("chessclub_token") || "");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [tournaments, setTournaments] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [resultForm, setResultForm] = useState(emptyResultForm);
  const [selectedId, setSelectedId] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [toasts, setToasts] = useState([]);
  const [activeTab, setActiveTab] = useState("overview"); // overview, tournaments, create, settings

  const deferredQuery = useDeferredValue(query.trim());

  const selectedTournament = useMemo(
    () => tournaments.find((item) => item.tournament_id === selectedId) || null,
    [selectedId, tournaments]
  );

  const stats = useMemo(() => {
    const planned = tournaments.filter((item) => item.status === "planned").length;
    const started = tournaments.filter((item) => item.status === "started").length;
    const finished = tournaments.filter((item) => item.status === "finished").length;

    return { total: tournaments.length, planned, started, finished };
  }, [tournaments]);

  function notify(message, type = "success") {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 3500);
  }

  const fetchTournaments = async (nextQuery = deferredQuery, nextStatus = statusFilter) => {
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
  };

  const fetchLeaderboard = async () => {
    if (!token || !user) return;
    try {
      const data = await getLeaderboard(token);
      setLeaderboard(data || []);
    } catch (err) {
      console.error("Leaderboard fetch failed", err);
    }
  };

  useEffect(() => {
    if (!token) {
      setAuthLoading(false);
      setUser(null);
      return;
    }

    (async () => {
      setAuthLoading(true);
      try {
        const profile = await me(token);
        setUser(profile);
      } catch {
        localStorage.removeItem("chessclub_token");
        setToken("");
        setUser(null);
      } finally {
        setAuthLoading(false);
      }
    })();
  }, [token]);

  useEffect(() => {
    if (!token || !user) return;
    fetchTournaments();
    fetchLeaderboard();
  }, [token, user, deferredQuery, statusFilter]);

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
      const payload = { ...form, scheduled_for };
      await createTournament(token, payload);
      setForm(emptyForm);
      notify("Tournament created");
      setActiveTab("tournaments");
      await fetchTournaments();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusyAction("");
    }
  }

  async function handleStart(tournamentId) {
    setBusyAction("start");
    try {
      await startTournament(token, tournamentId);
      notify("Tournament started");
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
      setResultForm(emptyResultForm);
      await fetchTournaments();
      await fetchLeaderboard();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusyAction("");
    }
  }

  async function handleNuke() {
    if (!window.confirm("Delete all records? This cannot be undone.")) return;
    setBusyAction("nuke");
    try {
      await nuke(token);
      notify("Database cleared", "error");
      window.location.reload();
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
  }

  if (authLoading) return <div className="app-shell app-shell--centered"><div className="loading-card">Loading...</div></div>;

  if (!token || !user) {
    return (
      <div className="app-shell app-shell--centered">
        <section className="auth-card">
          <p className="eyebrow">Chess Club</p>
          <h1>Admin Portal</h1>
          <form className="stack" onSubmit={handleLogin}>
            <label className="field">
              <span>Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {loginError && <p className="error-text">{loginError}</p>}
            <button className="button button--primary" type="submit" disabled={busyAction === "login"}>Sign in</button>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>Chess Club Admin</h1>
        <div className="topbar-actions">
          <button className="button" onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar stack">
          <button className={`button ${activeTab === 'overview' ? 'button--primary' : ''}`} onClick={() => setActiveTab('overview')}>Overview</button>
          <button className={`button ${activeTab === 'tournaments' ? 'button--primary' : ''}`} onClick={() => setActiveTab('tournaments')}>Tournaments</button>
          <button className={`button ${activeTab === 'create' ? 'button--primary' : ''}`} onClick={() => setActiveTab('create')}>New Tournament</button>
          <button className={`button ${activeTab === 'settings' ? 'button--primary' : ''}`} onClick={() => setActiveTab('settings')}>Settings</button>
          
          <div style={{ marginTop: 'auto' }}>
            <p className="muted">v1.1.0-mongo</p>
          </div>
        </aside>

        <main className="content">
          {activeTab === 'overview' && (
            <div className="stack">
              <section className="stats-grid" style={{ padding: 0 }}>
                <div className="stat-card"><span>Total</span><strong>{stats.total}</strong></div>
                <div className="stat-card"><span>Planned</span><strong>{stats.planned}</strong></div>
                <div className="stat-card"><span>Started</span><strong>{stats.started}</strong></div>
                <div className="stat-card"><span>Finished</span><strong>{stats.finished}</strong></div>
              </section>

              <section className="card">
                <div className="card-head"><h2>Leaderboard</h2></div>
                <div className="list">
                  {leaderboard.length === 0 ? <p className="empty-state">No wins recorded yet.</p> : 
                    leaderboard.map((player, idx) => (
                      <div key={player.username} className="list-item">
                        <strong>{idx + 1}. {player.username}</strong>
                        <span>{player.wins} wins</span>
                      </div>
                    ))
                  }
                </div>
              </section>
            </div>
          )}

          {activeTab === 'tournaments' && (
            <div className="stack">
              <section className="card">
                <div className="toolbar">
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search..." />
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="">All Status</option>
                    <option value="planned">Planned</option>
                    <option value="started">Started</option>
                    <option value="finished">Finished</option>
                  </select>
                </div>
                <div className="list">
                  {listLoading ? <p className="empty-state">Loading...</p> : 
                    tournaments.map(t => (
                      <button key={t.tournament_id} className={`list-item ${selectedId === t.tournament_id ? 'is-active' : ''}`} onClick={() => setSelectedId(t.tournament_id)}>
                        <div className="list-item__main"><strong>{t.name}</strong><span>{t.tournament_id}</span></div>
                        <div className="list-item__meta"><span className={`chip chip--${t.status}`}>{t.status}</span><span className="muted">{formatDate(t.scheduled_for)}</span></div>
                      </button>
                    ))
                  }
                </div>
              </section>

              {selectedTournament && (
                <section className="card">
                  <div className="card-head"><h2>{selectedTournament.name}</h2><span className={`chip chip--${selectedTournament.status}`}>{selectedTournament.status}</span></div>
                  <div className="detail-grid">
                    <div className="detail-item"><span>Format</span><strong>{selectedTournament.format}</strong></div>
                    <div className="detail-item"><span>Rated</span><strong>{selectedTournament.rated ? "Yes" : "No"}</strong></div>
                    <div className="detail-item"><span>Scheduled</span><strong>{formatDate(selectedTournament.scheduled_for)}</strong></div>
                    <div className="detail-item"><span>Created</span><strong>{formatDate(selectedTournament.created_at)}</strong></div>
                  </div>
                  <div className="detail-actions">
                    {selectedTournament.status === 'planned' && <button className="button button--primary" onClick={() => handleStart(selectedTournament.tournament_id)}>Start Now</button>}
                  </div>
                  {selectedTournament.status !== 'finished' && (
                    <form className="stack" style={{ marginTop: '2rem' }} onSubmit={handleFinish}>
                      <h3>Record Results</h3>
                      <input placeholder="Winner" value={resultForm.winner} onChange={e => setResultForm({...resultForm, winner: e.target.value})} required />
                      <input placeholder="Runner-up" value={resultForm.runner_up} onChange={e => setResultForm({...resultForm, runner_up: e.target.value})} />
                      <input placeholder="Third Place" value={resultForm.third_place} onChange={e => setResultForm({...resultForm, third_place: e.target.value})} />
                      <button className="button button--primary" type="submit" disabled={busyAction === 'finish'}>Publish Results</button>
                    </form>
                  )}
                </section>
              )}
            </div>
          )}

          {activeTab === 'create' && (
            <section className="card">
              <div className="card-head"><h2>New Tournament</h2></div>
              <form className="stack" onSubmit={handleCreate}>
                <label className="field"><span>Name</span><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></label>
                <label className="field"><span>Chess.com Link</span><input value={form.chesscom_link} onChange={e => setForm({...form, chesscom_link: e.target.value})} required /></label>
                <div className="form-row">
                  <label className="field"><span>Format</span><select value={form.format} onChange={e => setForm({...form, format: e.target.value})}><option value="Swiss">Swiss</option><option value="Arena">Arena</option></select></label>
                  <label className="field"><span>Rated</span><div className="toggle-row"><input type="checkbox" checked={form.rated} onChange={e => setForm({...form, rated: e.target.checked})} /><span>{form.rated ? 'Yes' : 'No'}</span></div></label>
                </div>
                <div className="form-row">
                  <label className="field"><span>Date</span><input type="date" value={form.scheduled_date} onChange={e => setForm({...form, scheduled_date: e.target.value})} /></label>
                  <label className="field"><span>Time</span><input type="time" value={form.scheduled_time} onChange={e => setForm({...form, scheduled_time: e.target.value})} /></label>
                </div>
                <label className="field"><span>Automate</span><div className="toggle-row"><input type="checkbox" checked={form.is_automated} onChange={e => setForm({...form, is_automated: e.target.checked})} /><span>{form.is_automated ? 'On' : 'Off'}</span></div></label>
                <button className="button button--primary" type="submit" disabled={busyAction === 'create'}>Schedule Tournament</button>
              </form>
            </section>
          )}

          {activeTab === 'settings' && (
            <section className="card card--danger stack">
              <h2>Danger Zone</h2>
              <p className="muted">This will delete all tournament and user records permanently.</p>
              <button className="button button--danger" onClick={handleNuke}>Nuke Database</button>
            </section>
          )}
        </main>
      </div>

      <div className="toast-stack">
        {toasts.map(t => <div key={t.id} className={`toast toast--${t.type}`}>{t.message}</div>)}
      </div>
    </div>
  );
}

export default App;
