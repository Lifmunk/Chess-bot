import { useDeferredValue, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
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
  updateTournament,
  deleteTournament,
  getUsers,
  linkUser,
  unlinkUser,
  announce,
  listAnnouncements,
  scheduleAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  getSettings,
  updateSettings,
} from "./api";

const emptyForm = {
  name: "",
  chesscom_link: "",
  format: "Swiss",
  time_control: "10 min",
  rules: "",
  description: "",
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

const emptyLinkUserForm = {
  discord_id: "",
  chesscom_username: "",
};

const emptyAnnouncementForm = {
  channel_id: "",
  message: "",
  scheduled_date: "",
  scheduled_time: "",
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
  const [users, setUsers] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [appSettings, setAppSettings] = useState({
    discord_guild_id: "",
    discord_announcement_channel_id: "",
    discord_results_channel_id: "",
    discord_puzzle_channel_id: "",
    discord_players_role_id: "",
    discord_verified_role_id: "",
    discord_champion_role_id: "",
    chesscom_club_id: "",
  });
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [resultForm, setResultForm] = useState(emptyResultForm);
  const [linkUserForm, setLinkUserForm] = useState(emptyLinkUserForm);
  const [announcementForm, setAnnouncementForm] = useState(emptyAnnouncementForm);
  const [selectedId, setSelectedId] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [toasts, setToasts] = useState([]);
  const [activeTab, setActiveTab] = useState("overview"); // overview, tournaments, users, create, settings

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

  const fetchUsers = async () => {
    if (!token || !user) return;
    try {
      const data = await getUsers(token);
      setUsers(data.items || []);
    } catch (err) {
      console.error("Users fetch failed", err);
    }
  };

  const fetchAnnouncements = async () => {
    if (!token || !user) return;
    try {
      const data = await listAnnouncements(token);
      setAnnouncements(data || []);
    } catch (err) {
      console.error("Announcements fetch failed", err);
    }
  };

  const fetchAppSettings = async () => {
    if (!token || !user) return;
    try {
      const data = await getSettings(token);
      setAppSettings(prev => ({ ...prev, ...data }));
    } catch (err) {
      console.error("Settings fetch failed", err);
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
    if (activeTab === 'overview') {
      fetchTournaments();
      fetchLeaderboard();
    } else if (activeTab === 'tournaments') {
      fetchTournaments();
    } else if (activeTab === 'users') {
      fetchUsers();
    } else if (activeTab === 'announce') {
      fetchAnnouncements();
    } else if (activeTab === 'settings') {
      fetchAppSettings();
    }
  }, [token, user, activeTab, deferredQuery, statusFilter]);

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

  async function handleUpdate(event) {
    event.preventDefault();
    if (!selectedId) return;
    setBusyAction("update");
    try {
      const scheduled_for =
        form.scheduled_date && form.scheduled_time
          ? new Date(`${form.scheduled_date}T${form.scheduled_time}`).toISOString()
          : null;
      const payload = { ...form, scheduled_for };
      await updateTournament(token, selectedId, payload);
      notify("Tournament updated");
      setIsEditing(false);
      await fetchTournaments();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusyAction("");
    }
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this tournament record?")) return;
    setBusyAction("delete");
    try {
      await deleteTournament(token, id);
      notify("Tournament deleted");
      setSelectedId("");
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

  async function handleManualLink(event) {
    event.preventDefault();
    setBusyAction("link");
    try {
      await linkUser(token, linkUserForm);
      notify("User linked successfully");
      setLinkUserForm(emptyLinkUserForm);
      await fetchUsers();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusyAction("");
    }
  }

  async function handleUnlink(discordId) {
    if (!window.confirm("Unlink this user?")) return;
    setBusyAction("unlink");
    try {
      await unlinkUser(token, discordId);
      notify("User unlinked");
      await fetchUsers();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusyAction("");
    }
  }

  async function handleAnnounce(event) {
    event.preventDefault();
    setBusyAction("announce");
    try {
      if (announcementForm.scheduled_date && announcementForm.scheduled_time) {
        const scheduled_for = new Date(`${announcementForm.scheduled_date}T${announcementForm.scheduled_time}`).toISOString();
        await scheduleAnnouncement(token, {
          channel_id: announcementForm.channel_id,
          message: announcementForm.message,
          scheduled_for
        });
        notify("Announcement scheduled");
        await fetchAnnouncements();
      } else {
        await announce(token, {
          channel_id: announcementForm.channel_id,
          message: announcementForm.message,
        });
        notify("Announcement sent immediately");
      }
      setAnnouncementForm(emptyAnnouncementForm);
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusyAction("");
    }
  }

  async function handleDeleteAnnouncement(id) {
    if (!window.confirm("Delete this scheduled announcement?")) return;
    setBusyAction("delete-ann");
    try {
      await deleteAnnouncement(token, id);
      notify("Announcement deleted");
      await fetchAnnouncements();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusyAction("");
    }
  }

  async function handleUpdateSettings(event) {
    event.preventDefault();
    setBusyAction("settings");
    try {
      await updateSettings(token, appSettings);
      notify("Settings updated successfully");
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

  function startEditing() {
    if (!selectedTournament) return;
    const dt = selectedTournament.scheduled_for ? new Date(selectedTournament.scheduled_for) : null;
    setForm({
      name: selectedTournament.name,
      chesscom_link: selectedTournament.chesscom_link,
      format: selectedTournament.format,
      time_control: selectedTournament.time_control || "10 min",
      rules: selectedTournament.rules || "",
      description: selectedTournament.description || "",
      rated: selectedTournament.rated,
      scheduled_date: dt ? dt.toISOString().split('T')[0] : "",
      scheduled_time: dt ? dt.toTimeString().split(' ')[0].slice(0, 5) : "",
      notes: selectedTournament.notes || "",
      is_automated: selectedTournament.is_automated,
      recurrence: selectedTournament.recurrence || "",
    });
    setIsEditing(true);
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
          <button className={`button ${activeTab === 'users' ? 'button--primary' : ''}`} onClick={() => setActiveTab('users')}>Linked Users</button>
          <button className={`button ${activeTab === 'announce' ? 'button--primary' : ''}`} onClick={() => setActiveTab('announce')}>Announcements</button>
          <button className={`button ${activeTab === 'create' ? 'button--primary' : ''}`} onClick={() => setActiveTab('create')}>New Tournament</button>
          <button className={`button ${activeTab === 'settings' ? 'button--primary' : ''}`} onClick={() => setActiveTab('settings')}>Settings</button>
          
          <div style={{ marginTop: 'auto' }}>
            <p className="muted">v1.2.0-automated</p>
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

              <div className="grid-cols-2">
                <section className="card">
                  <div className="card-head"><h2>Recent Winners</h2></div>
                  <div className="list">
                    {leaderboard.length === 0 ? <p className="empty-state">No wins recorded yet.</p> : 
                      leaderboard.map((player, idx) => (
                        <div key={player.username} className="list-item">
                          <div className="list-item__main">
                            <strong>{idx + 1}. {player.username}</strong>
                            <span>{player.wins} wins</span>
                          </div>
                        </div>
                      ))
                    }
                  </div>
                </section>

                <section className="card">
                    <div className="card-head"><h2>Next Up</h2></div>
                    <div className="list">
                        {tournaments.filter(t => t.status === 'planned').slice(0, 3).map(t => (
                            <div key={t.tournament_id} className="list-item">
                                <div className="list-item__main">
                                    <strong>{t.name}</strong>
                                    <span>{formatDate(t.scheduled_for)}</span>
                                </div>
                                <span className="chip chip--planned">Planned</span>
                            </div>
                        ))}
                        {tournaments.filter(t => t.status === 'planned').length === 0 && <p className="empty-state">No upcoming tournaments.</p>}
                    </div>
                </section>
              </div>
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
                      <button key={t.tournament_id} className={`list-item ${selectedId === t.tournament_id ? 'is-active' : ''}`} onClick={() => { setSelectedId(t.tournament_id); setIsEditing(false); }}>
                        <div className="list-item__main"><strong>{t.name}</strong><span>{t.tournament_id}</span></div>
                        <div className="list-item__meta"><span className={`chip chip--${t.status}`}>{t.status}</span><span className="muted">{formatDate(t.scheduled_for)}</span></div>
                      </button>
                    ))
                  }
                </div>
              </section>

              {selectedTournament && !isEditing && (
                <section className="card">
                  <div className="card-head">
                    <h2>{selectedTournament.name}</h2>
                    <div className="row" style={{ gap: '0.5rem' }}>
                        <button className="button button--small" onClick={startEditing}>Edit</button>
                        <button className="button button--small button--danger" onClick={() => handleDelete(selectedTournament.tournament_id)}>Delete</button>
                        <span className={`chip chip--${selectedTournament.status}`}>{selectedTournament.status}</span>
                    </div>
                  </div>
                  <div className="detail-grid">
                    <div className="detail-item"><span>Format</span><strong>{selectedTournament.format}</strong></div>
                    <div className="detail-item"><span>Time Control</span><strong>{selectedTournament.time_control}</strong></div>
                    <div className="detail-item"><span>Rated</span><strong>{selectedTournament.rated ? "Yes" : "No"}</strong></div>
                    <div className="detail-item"><span>Scheduled</span><strong>{formatDate(selectedTournament.scheduled_for)}</strong></div>
                    <div className="detail-item"><span>Automated</span><strong>{selectedTournament.is_automated ? "Yes" : "No"}</strong></div>
                    {selectedTournament.recurrence && <div className="detail-item"><span>Recurrence</span><strong>{selectedTournament.recurrence}</strong></div>}
                    <div className="detail-item"><span>Link</span><a href={selectedTournament.chesscom_link} target="_blank" rel="noreferrer">Open Chess.com</a></div>
                  </div>
                  {selectedTournament.description && (
                    <div className="detail-text-block">
                        <span>Description</span>
                        <p>{selectedTournament.description}</p>
                    </div>
                  )}
                  {selectedTournament.rules && (
                    <div className="detail-text-block">
                        <span>Rules</span>
                        <p>{selectedTournament.rules}</p>
                    </div>
                  )}
                  <div className="detail-actions" style={{ marginTop: '1rem' }}>
                    {selectedTournament.status === 'planned' && <button className="button button--primary" onClick={() => handleStart(selectedTournament.tournament_id)}>Start Now</button>}
                  </div>
                  {selectedTournament.status !== 'finished' && (
                    <form className="stack" style={{ marginTop: '2rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: '8px' }} onSubmit={handleFinish}>
                      <h3>Record Results Manually</h3>
                      <div className="form-row">
                        <input placeholder="Winner Username" value={resultForm.winner} onChange={e => setResultForm({...resultForm, winner: e.target.value})} required />
                        <input placeholder="Runner-up" value={resultForm.runner_up} onChange={e => setResultForm({...resultForm, runner_up: e.target.value})} />
                        <input placeholder="Third Place" value={resultForm.third_place} onChange={e => setResultForm({...resultForm, third_place: e.target.value})} />
                      </div>
                      <button className="button button--primary" type="submit" disabled={busyAction === 'finish'}>Publish Results</button>
                      <p className="muted small">If automated, results will be fetched automatically from Chess.com when finished.</p>
                    </form>
                  )}
                  {selectedTournament.status === 'finished' && (
                      <div className="stack" style={{ marginTop: '1rem' }}>
                          <h3>Results</h3>
                          <div className="detail-grid">
                            <div className="detail-item"><span>Winner</span><strong>{selectedTournament.winner}</strong></div>
                            <div className="detail-item"><span>Runner-up</span><strong>{selectedTournament.runner_up}</strong></div>
                            <div className="detail-item"><span>Third Place</span><strong>{selectedTournament.third_place}</strong></div>
                          </div>
                      </div>
                  )}
                </section>
              )}

              {selectedTournament && isEditing && (
                  <section className="card">
                      <div className="card-head"><h2>Edit Tournament</h2></div>
                      <form className="stack" onSubmit={handleUpdate}>
                        <label className="field"><span>Name</span><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></label>
                        <label className="field"><span>Chess.com Link</span><input value={form.chesscom_link} onChange={e => setForm({...form, chesscom_link: e.target.value})} required /></label>
                        <div className="form-row">
                          <label className="field"><span>Format</span><select value={form.format} onChange={e => setForm({...form, format: e.target.value})}><option value="Swiss">Swiss</option><option value="Arena">Arena</option></select></label>
                          <label className="field"><span>Time Control</span><input value={form.time_control} onChange={e => setForm({...form, time_control: e.target.value})} placeholder="e.g. 10 min" /></label>
                          <label className="field"><span>Rated</span><div className="toggle-row"><input type="checkbox" checked={form.rated} onChange={e => setForm({...form, rated: e.target.checked})} /><span>{form.rated ? 'Yes' : 'No'}</span></div></label>
                        </div>
                        <div className="form-row">
                          <label className="field"><span>Date</span><input type="date" value={form.scheduled_date} onChange={e => setForm({...form, scheduled_date: e.target.value})} /></label>
                          <label className="field"><span>Time</span><input type="time" value={form.scheduled_time} onChange={e => setForm({...form, scheduled_time: e.target.value})} /></label>
                        </div>
                        <label className="field"><span>Description</span><textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="What's this tournament about?" rows={3} /></label>
                        <label className="field"><span>Rules</span><textarea value={form.rules} onChange={e => setForm({...form, rules: e.target.value})} placeholder="Custom rules for this tournament" rows={3} /></label>
                        <div className="form-row">
                            <label className="field"><span>Automate</span><div className="toggle-row"><input type="checkbox" checked={form.is_automated} onChange={e => setForm({...form, is_automated: e.target.checked})} /><span>{form.is_automated ? 'On' : 'Off'}</span></div></label>
                            <label className="field"><span>Recurrence</span>
                                <select value={form.recurrence} onChange={e => setForm({...form, recurrence: e.target.value})}>
                                    <option value="">None</option>
                                    <option value="daily">Daily</option>
                                    <option value="weekly">Weekly</option>
                                    <option value="monthly">Monthly</option>
                                </select>
                            </label>
                        </div>
                        <div className="row" style={{ gap: '0.5rem' }}>
                            <button className="button button--primary" type="submit" disabled={busyAction === 'update'}>Save Changes</button>
                            <button className="button" type="button" onClick={() => setIsEditing(false)}>Cancel</button>
                        </div>
                    </form>
                  </section>
              )}
            </div>
          )}

          {activeTab === 'users' && (
              <div className="stack">
                <section className="card">
                    <div className="card-head"><h2>Link New User</h2></div>
                    <form className="form-row" onSubmit={handleManualLink}>
                        <input placeholder="Discord ID" value={linkUserForm.discord_id} onChange={e => setLinkUserForm({...linkUserForm, discord_id: e.target.value})} required />
                        <input placeholder="Chess.com Username" value={linkUserForm.chesscom_username} onChange={e => setLinkUserForm({...linkUserForm, chesscom_username: e.target.value})} required />
                        <button className="button button--primary" type="submit" disabled={busyAction === 'link'}>Link User</button>
                    </form>
                </section>

                <section className="card">
                    <div className="card-head"><h2>Linked Users</h2></div>
                    <div className="list">
                        {users.length === 0 ? <p className="empty-state">No users linked yet.</p> : 
                            users.map(u => (
                                <div key={u.discord_id} className="list-item">
                                    <div className="list-item__main">
                                        <strong>{u.chesscom_username}</strong>
                                        <span>ID: {u.discord_id}</span>
                                    </div>
                                    <div className="list-item__meta">
                                        <span className="muted">{formatDate(u.updated_at)}</span>
                                        <button className="button button--small button--danger" onClick={() => handleUnlink(u.discord_id)}>Unlink</button>
                                    </div>
                                </div>
                            ))
                        }
                    </div>
                </section>
              </div>
          )}

          {activeTab === 'announce' && (
            <div className="stack">
              <section className="card">
                <div className="card-head"><h2>Manual Announcement</h2></div>
                <form className="stack" onSubmit={handleAnnounce}>
                  <p className="muted">Send a manual message or schedule it for later. You can use Discord Markdown.</p>
                  <label className="field">
                    <span>Channel ID</span>
                    <input 
                      placeholder="e.g. 123456789012345678" 
                      value={announcementForm.channel_id} 
                      onChange={e => setAnnouncementForm({...announcementForm, channel_id: e.target.value})} 
                      required 
                    />
                  </label>
                  <div className="grid-cols-2">
                    <label className="field">
                      <span>Message</span>
                      <textarea 
                        placeholder="Enter your message here..." 
                        value={announcementForm.message} 
                        onChange={e => setAnnouncementForm({...announcementForm, message: e.target.value})} 
                        rows={10} 
                        required 
                      />
                    </label>
                    <div className="field">
                      <span>Preview</span>
                      <div className="markdown-preview" style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: '8px', minHeight: '200px', background: '#2c2f33', color: '#ffffff' }}>
                        <ReactMarkdown>{announcementForm.message || "*Message preview will appear here...*"}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                  <div className="form-row">
                    <label className="field">
                      <span>Scheduled Date (Optional)</span>
                      <input type="date" value={announcementForm.scheduled_date} onChange={e => setAnnouncementForm({...announcementForm, scheduled_date: e.target.value})} />
                    </label>
                    <label className="field">
                      <span>Scheduled Time (Optional)</span>
                      <input type="time" value={announcementForm.scheduled_time} onChange={e => setAnnouncementForm({...announcementForm, scheduled_time: e.target.value})} />
                    </label>
                  </div>
                  <button className="button button--primary" type="submit" disabled={busyAction === 'announce'}>
                    {busyAction === 'announce' ? 'Processing...' : (announcementForm.scheduled_date ? 'Schedule Announcement' : 'Send Immediately')}
                  </button>
                </form>
              </section>

              <section className="card">
                <div className="card-head"><h2>Scheduled & Recent Announcements</h2></div>
                <div className="list">
                  {announcements.length === 0 ? <p className="empty-state">No scheduled announcements.</p> : 
                    announcements.map(ann => (
                      <div key={ann.announcement_id} className="list-item">
                        <div className="list-item__main">
                          <strong style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '300px' }}>{ann.message}</strong>
                          <span>Channel: {ann.channel_id}</span>
                        </div>
                        <div className="list-item__meta">
                          <span className={`chip ${ann.sent ? 'chip--finished' : 'chip--planned'}`}>{ann.sent ? 'Sent' : 'Scheduled'}</span>
                          <span className="muted">{formatDate(ann.scheduled_for)}</span>
                          {!ann.sent && <button className="button button--small button--danger" onClick={() => handleDeleteAnnouncement(ann.announcement_id)}>Cancel</button>}
                        </div>
                      </div>
                    ))
                  }
                </div>
              </section>
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
                  <label className="field"><span>Time Control</span><input value={form.time_control} onChange={e => setForm({...form, time_control: e.target.value})} placeholder="e.g. 10 min" /></label>
                  <label className="field"><span>Rated</span><div className="toggle-row"><input type="checkbox" checked={form.rated} onChange={e => setForm({...form, rated: e.target.checked})} /><span>{form.rated ? 'Yes' : 'No'}</span></div></label>
                </div>
                <div className="form-row">
                  <label className="field"><span>Date</span><input type="date" value={form.scheduled_date} onChange={e => setForm({...form, scheduled_date: e.target.value})} /></label>
                  <label className="field"><span>Time</span><input type="time" value={form.scheduled_time} onChange={e => setForm({...form, scheduled_time: e.target.value})} /></label>
                </div>
                <label className="field"><span>Description</span><textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="What's this tournament about?" rows={3} /></label>
                <label className="field"><span>Rules</span><textarea value={form.rules} onChange={e => setForm({...form, rules: e.target.value})} placeholder="Custom rules for this tournament" rows={3} /></label>
                <div className="form-row">
                    <label className="field"><span>Automate</span><div className="toggle-row"><input type="checkbox" checked={form.is_automated} onChange={e => setForm({...form, is_automated: e.target.checked})} /><span>{form.is_automated ? 'On' : 'Off'}</span></div></label>
                    <label className="field"><span>Recurrence</span>
                        <select value={form.recurrence} onChange={e => setForm({...form, recurrence: e.target.value})}>
                            <option value="">None</option>
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                            <option value="monthly">Monthly</option>
                        </select>
                    </label>
                </div>
                <button className="button button--primary" type="submit" disabled={busyAction === 'create'}>Schedule Tournament</button>
              </form>
            </section>
          )}

          {activeTab === 'settings' && (
            <div className="stack">
                <section className="card">
                    <div className="card-head"><h2>Discord & Chess.com Configuration</h2></div>
                    <form className="stack" onSubmit={handleUpdateSettings}>
                        <div className="grid-cols-2">
                            <label className="field">
                                <span>Discord Guild ID</span>
                                <input value={appSettings.discord_guild_id} onChange={e => setAppSettings({...appSettings, discord_guild_id: e.target.value})} placeholder="Server ID" />
                            </label>
                            <label className="field">
                                <span>Chess.com Club ID</span>
                                <input value={appSettings.chesscom_club_id} onChange={e => setAppSettings({...appSettings, chesscom_club_id: e.target.value})} placeholder="e.g. chess-com-university" />
                            </label>
                        </div>
                        <div className="grid-cols-2">
                            <label className="field">
                                <span>Announcement Channel ID</span>
                                <input value={appSettings.discord_announcement_channel_id} onChange={e => setAppSettings({...appSettings, discord_announcement_channel_id: e.target.value})} placeholder="Channel for news" />
                            </label>
                            <label className="field">
                                <span>Results Channel ID</span>
                                <input value={appSettings.discord_results_channel_id} onChange={e => setAppSettings({...appSettings, discord_results_channel_id: e.target.value})} placeholder="Channel for tournament results" />
                            </label>
                        </div>
                        <div className="grid-cols-2">
                            <label className="field">
                                <span>Puzzle Channel ID</span>
                                <input value={appSettings.discord_puzzle_channel_id} onChange={e => setAppSettings({...appSettings, discord_puzzle_channel_id: e.target.value})} placeholder="Channel for daily puzzles" />
                            </label>
                            <label className="field">
                                <span>Players Role ID (Mention)</span>
                                <input value={appSettings.discord_players_role_id} onChange={e => setAppSettings({...appSettings, discord_players_role_id: e.target.value})} placeholder="Role to ping" />
                            </label>
                        </div>
                        <div className="grid-cols-2">
                            <label className="field">
                                <span>Verified Role ID</span>
                                <input value={appSettings.discord_verified_role_id} onChange={e => setAppSettings({...appSettings, discord_verified_role_id: e.target.value})} placeholder="Role given after /link" />
                            </label>
                            <label className="field">
                                <span>Champion Role ID</span>
                                <input value={appSettings.discord_champion_role_id} onChange={e => setAppSettings({...appSettings, discord_champion_role_id: e.target.value})} placeholder="Role given to winners" />
                            </label>
                        </div>
                        <button className="button button--primary" type="submit" disabled={busyAction === 'settings'}>
                            {busyAction === 'settings' ? 'Saving...' : 'Save Configuration'}
                        </button>
                    </form>
                </section>
                <section className="card">
                    <div className="card-head"><h2>Automation Info</h2></div>
                    <p>The bot polls Chess.com every minute to check for finished tournaments.</p>
                    <p>When a tournament is finished, it automatically:</p>
                    <ul style={{ marginLeft: '1.5rem', marginTop: '0.5rem' }}>
                        <li>Fetches the winner, runner-up, and third place.</li>
                        <li>Updates the tournament record in the database.</li>
                        <li>Announces results in Discord and pings the winner (if linked).</li>
                        <li>Assigns the <strong>Champion</strong> role to the winner (if linked).</li>
                    </ul>
                </section>
                <section className="card card--danger stack">
                    <h2>Danger Zone</h2>
                    <p className="muted">This will delete all tournament and user records permanently.</p>
                    <button className="button button--danger" onClick={handleNuke}>Nuke Database</button>
                </section>
            </div>
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
