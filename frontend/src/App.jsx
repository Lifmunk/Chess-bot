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
  const [activeTab, setActiveTab] = useState("overview");

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
      const scheduled_for = form.scheduled_date && form.scheduled_time ? new Date(`${form.scheduled_date}T${form.scheduled_time}`).toISOString() : null;
      await createTournament(token, { ...form, scheduled_for });
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
      const scheduled_for = form.scheduled_date && form.scheduled_time ? new Date(`${form.scheduled_date}T${form.scheduled_time}`).toISOString() : null;
      await updateTournament(token, selectedId, { ...form, scheduled_for });
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
        await scheduleAnnouncement(token, { channel_id: announcementForm.channel_id, message: announcementForm.message, scheduled_for });
        notify("Announcement scheduled");
        await fetchAnnouncements();
      } else {
        await announce(token, { channel_id: announcementForm.channel_id, message: announcementForm.message });
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

  if (authLoading) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><div className="card text-center animate-pulse">Loading...</div></div>;

  if (!token || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <section className="card max-w-md w-full p-10">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Chess Club</p>
          <h1 className="text-2xl font-bold text-slate-900 mb-6">Admin Portal</h1>
          <form className="space-y-4" onSubmit={handleLogin}>
            <div>
              <label className="label">Password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            {loginError && <p className="text-sm text-red-500">{loginError}</p>}
            <button className="btn btn-primary w-full" type="submit" disabled={busyAction === "login"}>Sign in</button>
          </form>
        </section>
      </div>
    );
  }

  const TabButton = ({ id, label }) => (
    <button 
      className={`w-full text-left px-4 py-3 rounded-lg font-medium transition-colors ${activeTab === id ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'text-slate-600 hover:bg-slate-100'}`} 
      onClick={() => setActiveTab(id)}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-8 py-4 sticky top-0 z-30 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center text-white font-bold">C</div>
          <h1 className="text-lg font-bold text-slate-800">Chess Club Admin</h1>
        </div>
        <button className="btn btn-small" onClick={handleLogout}>Sign out</button>
      </header>

      <div className="flex-1 max-w-7xl w-full mx-auto grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8 p-8">
        <aside className="space-y-2">
          <TabButton id="overview" label="Overview" />
          <TabButton id="tournaments" label="Tournaments" />
          <TabButton id="users" label="Linked Users" />
          <TabButton id="announce" label="Announcements" />
          <TabButton id="create" label="New Tournament" />
          <TabButton id="settings" label="Settings" />
          <div className="pt-8">
            <p className="text-xs text-slate-400 font-medium px-4">v1.3.0-tailwind</p>
          </div>
        </aside>

        <main className="space-y-8">
          {activeTab === 'overview' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "Total", val: stats.total, color: "text-slate-900" },
                  { label: "Planned", val: stats.planned, color: "text-blue-600" },
                  { label: "Started", val: stats.started, color: "text-green-600" },
                  { label: "Finished", val: stats.finished, color: "text-slate-500" },
                ].map(s => (
                  <div key={s.label} className="card p-4">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{s.label}</span>
                    <div className={`text-2xl font-bold ${s.color}`}>{s.val}</div>
                  </div>
                ))}
              </section>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <section className="card">
                  <h2 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <span className="w-2 h-2 bg-yellow-400 rounded-full"></span> Recent Winners
                  </h2>
                  <div className="space-y-3">
                    {leaderboard.length === 0 ? <p className="text-sm text-slate-400 text-center py-4">No wins recorded yet.</p> : 
                      leaderboard.map((player, idx) => (
                        <div key={player.username} className="flex justify-between items-center p-3 rounded-lg border border-slate-50 bg-slate-50/50">
                          <strong className="text-sm text-slate-700">{idx + 1}. {player.username}</strong>
                          <span className="text-xs font-bold text-slate-500 bg-white px-2 py-1 rounded border border-slate-100">{player.wins} wins</span>
                        </div>
                      ))
                    }
                  </div>
                </section>

                <section className="card">
                    <h2 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
                      <span className="w-2 h-2 bg-blue-400 rounded-full"></span> Next Up
                    </h2>
                    <div className="space-y-3">
                        {tournaments.filter(t => t.status === 'planned').slice(0, 3).map(t => (
                            <div key={t.tournament_id} className="flex justify-between items-center p-3 rounded-lg border border-slate-50 bg-slate-50/50">
                                <div className="flex flex-col">
                                    <strong className="text-sm text-slate-700">{t.name}</strong>
                                    <span className="text-[10px] text-slate-400 font-medium">{formatDate(t.scheduled_for)}</span>
                                </div>
                                <span className="chip bg-blue-50 text-blue-600 border border-blue-100">Planned</span>
                            </div>
                        ))}
                        {tournaments.filter(t => t.status === 'planned').length === 0 && <p className="text-sm text-slate-400 text-center py-4">No upcoming tournaments.</p>}
                    </div>
                </section>
              </div>
            </div>
          )}

          {activeTab === 'tournaments' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              <section className="card space-y-4">
                <div className="flex flex-col sm:flex-row gap-4">
                  <input className="input flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tournaments..." />
                  <select className="input sm:w-48" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="">All Status</option>
                    <option value="planned">Planned</option>
                    <option value="started">Started</option>
                    <option value="finished">Finished</option>
                  </select>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {listLoading ? <p className="col-span-full text-center py-8 text-slate-400">Loading...</p> : 
                    tournaments.map(t => (
                      <button 
                        key={t.tournament_id} 
                        className={`text-left p-4 rounded-xl border transition-all ${selectedId === t.tournament_id ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-slate-100 hover:border-slate-300 hover:bg-slate-50'}`} 
                        onClick={() => { setSelectedId(t.tournament_id); setIsEditing(false); }}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <strong className="text-sm text-slate-800 line-clamp-1">{t.name}</strong>
                          <span className={`chip ${t.status === 'planned' ? 'bg-blue-50 text-blue-600' : t.status === 'started' ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-600'}`}>
                            {t.status}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                          <span>{t.tournament_id}</span>
                          <span>{formatDate(t.scheduled_for)}</span>
                        </div>
                      </button>
                    ))
                  }
                </div>
              </section>

              {selectedTournament && !isEditing && (
                <section className="card space-y-6 animate-in slide-in-from-right-4 duration-300">
                  <div className="flex justify-between items-start border-b border-slate-100 pb-6">
                    <div>
                      <h2 className="text-xl font-bold text-slate-900">{selectedTournament.name}</h2>
                      <p className="text-xs text-slate-400 font-medium">{selectedTournament.tournament_id}</p>
                    </div>
                    <div className="flex gap-2">
                        <button className="btn btn-small" onClick={startEditing}>Edit</button>
                        <button className="btn btn-small btn-danger" onClick={() => handleDelete(selectedTournament.tournament_id)}>Delete</button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    {[
                      { l: "Format", v: selectedTournament.format },
                      { l: "Time Control", v: selectedTournament.time_control },
                      { l: "Rated", v: selectedTournament.rated ? "Yes" : "No" },
                      { l: "Automated", v: selectedTournament.is_automated ? "Yes" : "No" },
                    ].map(i => (
                      <div key={i.l} className="space-y-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{i.l}</span>
                        <div className="text-sm font-semibold text-slate-700">{i.v}</div>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Scheduled</span>
                      <div className="text-sm font-semibold text-slate-700">{formatDate(selectedTournament.scheduled_for)}</div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Link</span>
                      <div><a className="text-sm font-semibold text-blue-600 hover:underline" href={selectedTournament.chesscom_link} target="_blank" rel="noreferrer">Open Chess.com ↗</a></div>
                    </div>
                  </div>

                  {(selectedTournament.description || selectedTournament.rules) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {selectedTournament.description && (
                        <div className="bg-slate-50 p-4 rounded-lg">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">Description</span>
                          <p className="text-sm text-slate-600 leading-relaxed">{selectedTournament.description}</p>
                        </div>
                      )}
                      {selectedTournament.rules && (
                        <div className="bg-slate-50 p-4 rounded-lg">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">Rules</span>
                          <p className="text-sm text-slate-600 leading-relaxed">{selectedTournament.rules}</p>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="pt-4 border-t border-slate-100 flex justify-between items-end">
                    {selectedTournament.status === 'planned' && (
                      <button className="btn btn-primary" onClick={() => handleStart(selectedTournament.tournament_id)}>Start Now</button>
                    )}
                    {selectedTournament.status !== 'finished' && (
                      <form className="bg-slate-50/50 p-6 rounded-xl border border-slate-100 w-full max-w-lg space-y-4 ml-auto" onSubmit={handleFinish}>
                        <h3 className="text-sm font-bold text-slate-800">Publish Results Manually</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <input className="input text-sm" placeholder="Winner" value={resultForm.winner} onChange={e => setResultForm({...resultForm, winner: e.target.value})} required />
                          <input className="input text-sm" placeholder="Runner-up" value={resultForm.runner_up} onChange={e => setResultForm({...resultForm, runner_up: e.target.value})} />
                          <input className="input text-sm" placeholder="3rd Place" value={resultForm.third_place} onChange={e => setResultForm({...resultForm, third_place: e.target.value})} />
                        </div>
                        <div className="flex justify-between items-center">
                          <p className="text-[10px] text-slate-400 font-medium italic">Results are also auto-fetched when finished.</p>
                          <button className="btn btn-primary btn-small" type="submit" disabled={busyAction === 'finish'}>Publish</button>
                        </div>
                      </form>
                    )}
                    {selectedTournament.status === 'finished' && (
                        <div className="w-full bg-blue-50/50 p-6 rounded-xl border border-blue-100">
                            <h3 className="text-sm font-bold text-blue-800 mb-4">Official Results</h3>
                            <div className="grid grid-cols-3 gap-4">
                              {[
                                { l: "Winner", v: selectedTournament.winner, c: "text-blue-700" },
                                { l: "Runner-up", v: selectedTournament.runner_up, c: "text-slate-600" },
                                { l: "3rd Place", v: selectedTournament.third_place, c: "text-slate-600" },
                              ].map(r => (
                                <div key={r.l}>
                                  <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest block mb-1">{r.l}</span>
                                  <strong className={`text-sm ${r.c}`}>{r.v || "N/A"}</strong>
                                </div>
                              ))}
                            </div>
                        </div>
                    )}
                  </div>
                </section>
              )}

              {selectedTournament && isEditing && (
                  <section className="card space-y-6">
                      <h2 className="text-xl font-bold text-slate-900 border-b border-slate-100 pb-4">Edit Tournament</h2>
                      <form className="space-y-6" onSubmit={handleUpdate}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <label className="block"><span className="label">Tournament Name</span><input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></label>
                          <label className="block"><span className="label">Chess.com Link</span><input className="input" value={form.chesscom_link} onChange={e => setForm({...form, chesscom_link: e.target.value})} required /></label>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <label className="block"><span className="label">Format</span><select className="input" value={form.format} onChange={e => setForm({...form, format: e.target.value})}><option value="Swiss">Swiss</option><option value="Arena">Arena</option></select></label>
                          <label className="block"><span className="label">Time Control</span><input className="input" value={form.time_control} onChange={e => setForm({...form, time_control: e.target.value})} placeholder="e.g. 10 min" /></label>
                          <label className="block"><span className="label">Rated</span><div className="flex items-center gap-2 mt-2"><input type="checkbox" className="w-4 h-4 text-blue-600 rounded" checked={form.rated} onChange={e => setForm({...form, rated: e.target.checked})} /><span className="text-sm font-medium text-slate-600">{form.rated ? 'Yes' : 'No'}</span></div></label>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <label className="block"><span className="label">Date</span><input className="input" type="date" value={form.scheduled_date} onChange={e => setForm({...form, scheduled_date: e.target.value})} /></label>
                          <label className="block"><span className="label">Time</span><input className="input" type="time" value={form.scheduled_time} onChange={e => setForm({...form, scheduled_time: e.target.value})} /></label>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <label className="block"><span className="label">Description</span><textarea className="input" value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={3} /></label>
                          <label className="block"><span className="label">Rules</span><textarea className="input" value={form.rules} onChange={e => setForm({...form, rules: e.target.value})} rows={3} /></label>
                        </div>
                        <div className="flex gap-8 items-center pt-2 border-t border-slate-100">
                            <label className="flex items-center gap-2"><input type="checkbox" className="w-4 h-4 text-blue-600 rounded" checked={form.is_automated} onChange={e => setForm({...form, is_automated: e.target.checked})} /><span className="text-sm font-bold text-slate-700">Enable Automation</span></label>
                            <label className="flex items-center gap-2"><span className="text-sm font-bold text-slate-700">Recurrence</span><select className="input py-1 text-sm" value={form.recurrence} onChange={e => setForm({...form, recurrence: e.target.value})}><option value="">None</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
                        </div>
                        <div className="flex gap-3 pt-4">
                            <button className="btn btn-primary" type="submit" disabled={busyAction === 'update'}>Save Changes</button>
                            <button className="btn" type="button" onClick={() => setIsEditing(false)}>Cancel</button>
                        </div>
                    </form>
                  </section>
              )}
            </div>
          )}

          {activeTab === 'users' && (
              <div className="space-y-8 animate-in fade-in duration-300">
                <section className="card space-y-6">
                    <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-4">Link New User</h2>
                    <form className="flex flex-col sm:flex-row gap-4" onSubmit={handleManualLink}>
                        <input className="input flex-1" placeholder="Discord ID (e.g. 123...)" value={linkUserForm.discord_id} onChange={e => setLinkUserForm({...linkUserForm, discord_id: e.target.value})} required />
                        <input className="input flex-1" placeholder="Chess.com Username" value={linkUserForm.chesscom_username} onChange={e => setLinkUserForm({...linkUserForm, chesscom_username: e.target.value})} required />
                        <button className="btn btn-primary whitespace-nowrap" type="submit" disabled={busyAction === 'link'}>Link Account</button>
                    </form>
                </section>

                <section className="card space-y-6">
                    <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-4">Linked Members</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {users.length === 0 ? <p className="col-span-full text-center py-12 text-slate-400">No members linked yet.</p> : 
                            users.map(u => (
                                <div key={u.discord_id} className="p-4 rounded-xl border border-slate-100 bg-white flex justify-between items-center group hover:border-slate-300 transition-all">
                                    <div>
                                        <strong className="text-sm text-slate-800 block">{u.chesscom_username}</strong>
                                        <span className="text-[10px] text-slate-400 font-bold font-mono">ID: {u.discord_id}</span>
                                    </div>
                                    <div className="flex flex-col items-end gap-2">
                                        <span className="text-[9px] font-bold text-slate-300 uppercase">{formatDate(u.updated_at).split(',')[0]}</span>
                                        <button className="text-xs font-bold text-red-500 opacity-0 group-hover:opacity-100 transition-opacity hover:underline" onClick={() => handleUnlink(u.discord_id)}>Unlink</button>
                                    </div>
                                </div>
                            ))
                        }
                    </div>
                </section>
              </div>
          )}

          {activeTab === 'announce' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              <section className="card space-y-6">
                <h2 className="text-xl font-bold text-slate-900 border-b border-slate-100 pb-4">Compose Announcement</h2>
                <form className="space-y-6" onSubmit={handleAnnounce}>
                  <label className="block">
                    <span className="label">Target Channel ID</span>
                    <input className="input max-w-sm" placeholder="e.g. 123456789..." value={announcementForm.channel_id} onChange={e => setAnnouncementForm({...announcementForm, channel_id: e.target.value})} required />
                  </label>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <label className="block space-y-2">
                      <span className="label">Markdown Message</span>
                      <textarea className="input font-mono text-sm" placeholder="Enter your message here..." value={announcementForm.message} onChange={e => setAnnouncementForm({...announcementForm, message: e.target.value})} rows={12} required />
                    </label>
                    <div className="space-y-2">
                      <span className="label">Live Discord Preview</span>
                      <div className="rounded-xl p-6 bg-[#313338] text-[#dbdee1] min-h-[300px] border border-slate-800 shadow-inner overflow-auto prose prose-invert prose-sm max-w-none">
                        <ReactMarkdown className="markdown-body">
                          {announcementForm.message || "*Compose a message to see the preview...*"}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-6 pt-4 border-t border-slate-100">
                    <label className="block"><span className="label">Scheduled Date</span><input className="input" type="date" value={announcementForm.scheduled_date} onChange={e => setAnnouncementForm({...announcementForm, scheduled_date: e.target.value})} /></label>
                    <label className="block"><span className="label">Scheduled Time</span><input className="input" type="time" value={announcementForm.scheduled_time} onChange={e => setAnnouncementForm({...announcementForm, scheduled_time: e.target.value})} /></label>
                    <div className="sm:ml-auto flex items-end">
                      <button className="btn btn-primary px-8" type="submit" disabled={busyAction === 'announce'}>
                        {busyAction === 'announce' ? 'Sending...' : (announcementForm.scheduled_date ? 'Schedule Post' : 'Post Now')}
                      </button>
                    </div>
                  </div>
                </form>
              </section>

              <section className="card space-y-6">
                <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-4">Broadcast Queue</h2>
                <div className="space-y-3">
                  {announcements.length === 0 ? <p className="text-center py-12 text-slate-400">No broadcasts found.</p> : 
                    announcements.map(ann => (
                      <div key={ann.announcement_id} className="flex flex-col sm:flex-row justify-between sm:items-center p-4 rounded-xl border border-slate-100 hover:border-slate-200 transition-all gap-4">
                        <div className="flex-1 min-w-0">
                          <strong className="text-sm text-slate-700 block truncate">{ann.message}</strong>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Channel: {ann.channel_id}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className={`chip ${ann.sent ? 'bg-slate-100 text-slate-500' : 'bg-blue-50 text-blue-600'}`}>{ann.sent ? 'Sent' : 'Queued'}</span>
                          <span className="text-xs font-medium text-slate-500 whitespace-nowrap">{formatDate(ann.scheduled_for)}</span>
                          {!ann.sent && <button className="btn btn-small btn-danger" onClick={() => handleDeleteAnnouncement(ann.announcement_id)}>Cancel</button>}
                        </div>
                      </div>
                    ))
                  }
                </div>
              </section>
            </div>
          )}

          {activeTab === 'create' && (
            <section className="card space-y-8 animate-in slide-in-from-bottom-4 duration-500">
              <h2 className="text-2xl font-bold text-slate-900 border-b border-slate-100 pb-4">Schedule New Tournament</h2>
              <form className="space-y-6" onSubmit={handleCreate}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <label className="block"><span className="label">Tournament Name</span><input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required placeholder="Weekly Blitz Open" /></label>
                  <label className="block"><span className="label">Chess.com Tournament URL</span><input className="input" value={form.chesscom_link} onChange={e => setForm({...form, chesscom_link: e.target.value})} required placeholder="https://www.chess.com/tournament/live/..." /></label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <label className="block"><span className="label">Tournament Format</span><select className="input" value={form.format} onChange={e => setForm({...form, format: e.target.value})}><option value="Swiss">Swiss</option><option value="Arena">Arena</option></select></label>
                  <label className="block"><span className="label">Time Control</span><input className="input" value={form.time_control} onChange={e => setForm({...form, time_control: e.target.value})} placeholder="10 min" /></label>
                  <label className="block"><span className="label">Rated Status</span><div className="flex items-center gap-2 mt-2"><input type="checkbox" className="w-4 h-4 text-blue-600 rounded" checked={form.rated} onChange={e => setForm({...form, rated: e.target.checked})} /><span className="text-sm font-bold text-slate-700">{form.rated ? 'Rated' : 'Unrated'}</span></div></label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 bg-slate-50 rounded-2xl">
                  <label className="block"><span className="label text-blue-600">Start Date</span><input className="input border-blue-100" type="date" value={form.scheduled_date} onChange={e => setForm({...form, scheduled_date: e.target.value})} /></label>
                  <label className="block"><span className="label text-blue-600">Start Time (UTC)</span><input className="input border-blue-100" type="time" value={form.scheduled_time} onChange={e => setForm({...form, scheduled_time: e.target.value})} /></label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <label className="block"><span className="label">Internal Description</span><textarea className="input" value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Visibility: Public" rows={4} /></label>
                  <label className="block"><span className="label">Internal Rules</span><textarea className="input" value={form.rules} onChange={e => setForm({...form, rules: e.target.value})} placeholder="Visibility: Staff Only" rows={4} /></label>
                </div>
                <div className="flex flex-col sm:flex-row gap-8 items-center pt-6 border-t border-slate-100">
                    <label className="flex items-center gap-3 bg-blue-50/50 px-4 py-2 rounded-lg"><input type="checkbox" className="w-5 h-5 text-blue-600 rounded" checked={form.is_automated} onChange={e => setForm({...form, is_automated: e.target.checked})} /><span className="text-sm font-bold text-blue-800 tracking-tight uppercase">Auto-Start & Results</span></label>
                    <label className="flex items-center gap-3"><span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Recurrence</span><select className="input py-1 text-sm bg-transparent border-none focus:ring-0 font-bold text-slate-700" value={form.recurrence} onChange={e => setForm({...form, recurrence: e.target.value})}><option value="">Manual Only</option><option value="daily">Daily Event</option><option value="weekly">Weekly Event</option><option value="monthly">Monthly Event</option></select></label>
                    <button className="btn btn-primary sm:ml-auto px-10 py-3 shadow-lg shadow-blue-200" type="submit" disabled={busyAction === 'create'}>Schedule Tournament</button>
                </div>
              </form>
            </section>
          )}

          {activeTab === 'settings' && (
            <div className="space-y-8 animate-in fade-in duration-300">
                <section className="card space-y-8">
                    <h2 className="text-xl font-bold text-slate-900 border-b border-slate-100 pb-4">Global Configuration</h2>
                    <form className="space-y-8" onSubmit={handleUpdateSettings}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <label className="block space-y-2"><span className="label">Discord Server ID</span><input className="input font-mono" value={appSettings.discord_guild_id} onChange={e => setAppSettings({...appSettings, discord_guild_id: e.target.value})} placeholder="000000000000000000" /></label>
                            <label className="block space-y-2"><span className="label">Chess.com Club ID</span><input className="input font-mono" value={appSettings.chesscom_club_id} onChange={e => setAppSettings({...appSettings, chesscom_club_id: e.target.value})} placeholder="club-name-id" /></label>
                        </div>
                        
                        <div className="space-y-4">
                          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] border-b border-slate-50 pb-2">Channel Routing</h3>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <label className="block space-y-1"><span className="label text-[11px]">Announcements</span><input className="input font-mono text-xs" value={appSettings.discord_announcement_channel_id} onChange={e => setAppSettings({...appSettings, discord_announcement_channel_id: e.target.value})} /></label>
                            <label className="block space-y-1"><span className="label text-[11px]">Results</span><input className="input font-mono text-xs" value={appSettings.discord_results_channel_id} onChange={e => setAppSettings({...appSettings, discord_results_channel_id: e.target.value})} /></label>
                            <label className="block space-y-1"><span className="label text-[11px]">Daily Puzzles</span><input className="input font-mono text-xs" value={appSettings.discord_puzzle_channel_id} onChange={e => setAppSettings({...appSettings, discord_puzzle_channel_id: e.target.value})} /></label>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] border-b border-slate-50 pb-2">Role Management</h3>
                          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                            <label className="block space-y-1"><span className="label text-[11px]">Player Ping</span><input className="input font-mono text-xs" value={appSettings.discord_players_role_id} onChange={e => setAppSettings({...appSettings, discord_players_role_id: e.target.value})} /></label>
                            <label className="block space-y-1"><span className="label text-[11px]">Verified Role</span><input className="input font-mono text-xs" value={appSettings.discord_verified_role_id} onChange={e => setAppSettings({...appSettings, discord_verified_role_id: e.target.value})} /></label>
                            <label className="block space-y-1"><span className="label text-[11px]">Champion Role</span><input className="input font-mono text-xs" value={appSettings.discord_champion_role_id} onChange={e => setAppSettings({...appSettings, discord_champion_role_id: e.target.value})} /></label>
                          </div>
                        </div>

                        <button className="btn btn-primary px-12" type="submit" disabled={busyAction === 'settings'}>
                            {busyAction === 'settings' ? 'Updating...' : 'Save All Settings'}
                        </button>
                    </form>
                </section>
                
                <section className="bg-red-50 p-8 rounded-2xl border border-red-100 space-y-4">
                    <h2 className="text-lg font-bold text-red-800">Danger Zone</h2>
                    <p className="text-sm text-red-600 font-medium">Permanently delete all tournament records and linked user data. This action is irreversible.</p>
                    <button className="btn border-red-200 text-red-600 font-bold bg-white hover:bg-red-50" onClick={handleNuke}>Purge System Database</button>
                </section>
            </div>
          )}
        </main>
      </div>

      <div className="fixed bottom-8 right-8 space-y-3 z-50">
        {toasts.map(t => (
          <div key={t.id} className={`px-6 py-3 rounded-xl shadow-xl border text-sm font-bold animate-in slide-in-from-right-10 duration-300 ${t.type === 'error' ? 'bg-red-600 border-red-700 text-white' : 'bg-slate-900 border-slate-800 text-white'}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
