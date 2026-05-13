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
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1 text-center">Chess Club</p>
          <h1 className="text-2xl font-bold text-slate-900 mb-6 text-center">Admin Portal</h1>
          <form className="space-y-4" onSubmit={handleLogin}>
            <div>
              <label className="label">Password</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            {loginError && <p className="text-sm text-red-500">{loginError}</p>}
            <button className="btn btn-primary w-full py-3" type="submit" disabled={busyAction === "login"}>Sign in</button>
          </form>
        </section>
      </div>
    );
  }

  const TabButton = ({ id, label }) => (
    <button 
      className={`w-full text-left px-4 py-3 rounded-lg font-medium transition-all ${activeTab === id ? 'bg-blue-600 text-white shadow-lg shadow-blue-200 translate-x-1' : 'text-slate-600 hover:bg-slate-100'}`} 
      onClick={() => setActiveTab(id)}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-8 py-4 sticky top-0 z-30 flex justify-between items-center shadow-sm shadow-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center text-white font-bold">C</div>
          <h1 className="text-lg font-bold text-slate-800">Chess Club Admin</h1>
        </div>
        <button className="btn btn-small" onClick={handleLogout}>Sign out</button>
      </header>

      <div className="flex-1 max-w-7xl w-full mx-auto grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8 p-8">
        <aside className="space-y-1">
          <TabButton id="overview" label="Overview" />
          <TabButton id="tournaments" label="Tournaments" />
          <TabButton id="users" label="Linked Users" />
          <TabButton id="announce" label="Announcements" />
          <TabButton id="create" label="New Tournament" />
          <TabButton id="settings" label="Settings" />
          <div className="pt-8 px-4">
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">System Info</p>
            <p className="text-[11px] text-slate-500 font-medium mt-1">v1.3.0-tailwind</p>
          </div>
        </aside>

        <main className="space-y-8 min-w-0">
          {activeTab === 'overview' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "Total", val: stats.total, color: "text-slate-900", icon: "📊" },
                  { label: "Planned", val: stats.planned, color: "text-blue-600", icon: "📅" },
                  { label: "Started", val: stats.started, color: "text-green-600", icon: "⚡" },
                  { label: "Finished", val: stats.finished, color: "text-slate-500", icon: "🏆" },
                ].map(s => (
                  <div key={s.label} className="card p-6 border-l-4 border-l-blue-500 hover:scale-[1.02] transition-transform">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{s.label}</span>
                        <span>{s.icon}</span>
                    </div>
                    <div className={`text-3xl font-bold ${s.color}`}>{s.val}</div>
                  </div>
                ))}
              </section>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <section className="card space-y-4">
                  <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <span className="w-2 h-2 bg-yellow-400 rounded-full"></span> Recent Winners
                  </h2>
                  <div className="space-y-2">
                    {leaderboard.length === 0 ? <p className="text-sm text-slate-400 text-center py-6">No wins recorded yet.</p> : 
                      leaderboard.map((player, idx) => (
                        <div key={player.username} className="flex justify-between items-center p-3 rounded-xl border border-slate-50 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                          <strong className="text-sm text-slate-700">{idx + 1}. {player.username}</strong>
                          <span className="text-[11px] font-bold text-slate-500 bg-white px-2.5 py-1 rounded-lg border border-slate-100 shadow-sm">{player.wins} wins</span>
                        </div>
                      ))
                    }
                  </div>
                </section>

                <section className="card space-y-4">
                    <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                      <span className="w-2 h-2 bg-blue-400 rounded-full"></span> Next Up
                    </h2>
                    <div className="space-y-2">
                        {tournaments.filter(t => t.status === 'planned').slice(0, 3).map(t => (
                            <div key={t.tournament_id} className="flex justify-between items-center p-3 rounded-xl border border-slate-50 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                                <div className="flex flex-col min-w-0">
                                    <strong className="text-sm text-slate-700 truncate">{t.name}</strong>
                                    <span className="text-[10px] text-slate-400 font-bold">{formatDate(t.scheduled_for)}</span>
                                </div>
                                <span className="chip bg-blue-50 text-blue-600 border-blue-100 whitespace-nowrap">Planned</span>
                            </div>
                        ))}
                        {tournaments.filter(t => t.status === 'planned').length === 0 && <p className="text-sm text-slate-400 text-center py-6">No upcoming tournaments.</p>}
                    </div>
                </section>
              </div>
            </div>
          )}

          {activeTab === 'tournaments' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              <section className="card space-y-4 p-4 md:p-6">
                <div className="flex flex-col md:flex-row gap-4">
                  <div className="relative flex-1">
                    <input className="input pl-10" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tournaments by name or ID..." />
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
                  </div>
                  <select className="input md:w-48 font-bold text-slate-600" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="">All Statuses</option>
                    <option value="planned">Planned</option>
                    <option value="started">Started</option>
                    <option value="finished">Finished</option>
                  </select>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {listLoading ? <div className="col-span-full py-12 flex justify-center"><div className="w-8 h-8 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div></div> : 
                    tournaments.map(t => (
                      <button 
                        key={t.tournament_id} 
                        className={`text-left p-4 rounded-xl border transition-all ${selectedId === t.tournament_id ? 'border-blue-500 bg-blue-50/50 ring-1 ring-blue-500 shadow-md' : 'border-slate-100 hover:border-slate-300 hover:bg-white hover:shadow-sm'}`} 
                        onClick={() => { setSelectedId(t.tournament_id); setIsEditing(false); }}
                      >
                        <div className="flex justify-between items-start mb-3">
                          <strong className="text-sm text-slate-800 line-clamp-1 flex-1 mr-2">{t.name}</strong>
                          <span className={`chip shrink-0 ${t.status === 'planned' ? 'bg-blue-50 text-blue-600 border-blue-100' : t.status === 'started' ? 'bg-green-50 text-green-600 border-green-100' : 'bg-slate-50 text-slate-500 border-slate-100'}`}>
                            {t.status}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[9px] text-slate-400 font-bold uppercase tracking-widest">
                          <span className="bg-slate-100 px-1.5 py-0.5 rounded">{t.tournament_id}</span>
                          <span>{formatDate(t.scheduled_for).split(',')[0]}</span>
                        </div>
                      </button>
                    ))
                  }
                </div>
              </section>

              {selectedTournament && !isEditing && (
                <section className="card space-y-8 animate-in slide-in-from-right-4 duration-400">
                  <div className="flex flex-col sm:flex-row justify-between items-start gap-4 border-b border-slate-100 pb-6">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{selectedTournament.name}</h2>
                      <p className="text-xs text-slate-400 font-bold mt-1 uppercase tracking-widest">{selectedTournament.tournament_id}</p>
                    </div>
                    <div className="flex gap-2">
                        <button className="btn btn-small hover:bg-slate-50" onClick={startEditing}>Edit Details</button>
                        <button className="btn btn-small btn-danger" onClick={() => handleDelete(selectedTournament.tournament_id)}>Delete</button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                    {[
                      { l: "Format", v: selectedTournament.format, icon: "🏆" },
                      { l: "Time Control", v: selectedTournament.time_control, icon: "⏱️" },
                      { l: "Rated", v: selectedTournament.rated ? "Yes" : "No", icon: "💎" },
                      { l: "Automation", v: selectedTournament.is_automated ? "Active" : "Disabled", icon: "🤖" },
                    ].map(i => (
                      <div key={i.l} className="space-y-1.5 bg-slate-50/50 p-3 rounded-xl border border-slate-50">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.15em] flex items-center gap-1.5">{i.icon} {i.l}</span>
                        <div className="text-sm font-bold text-slate-700">{i.v}</div>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-1.5">
                      <span className="label">Scheduled Start</span>
                      <div className="text-sm font-semibold text-slate-700 bg-white p-3 rounded-lg border border-slate-100 shadow-sm">{formatDate(selectedTournament.scheduled_for)}</div>
                    </div>
                    <div className="space-y-1.5">
                      <span className="label">Chess.com Tournament Link</span>
                      <div className="flex">
                        <a className="text-sm font-bold text-blue-600 hover:text-blue-700 bg-blue-50 px-4 py-3 rounded-lg border border-blue-100 flex-1 hover:underline transition-colors" href={selectedTournament.chesscom_link} target="_blank" rel="noreferrer">Open Tournament Page ↗</a>
                      </div>
                    </div>
                  </div>

                  {(selectedTournament.description || selectedTournament.rules) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      {selectedTournament.description && (
                        <div className="space-y-1.5">
                          <span className="label">Public Description</span>
                          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-sm text-slate-600 leading-relaxed min-h-[100px]">{selectedTournament.description}</div>
                        </div>
                      )}
                      {selectedTournament.rules && (
                        <div className="space-y-1.5">
                          <span className="label">Staff Notes / Rules</span>
                          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-sm text-slate-600 leading-relaxed min-h-[100px]">{selectedTournament.rules}</div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="pt-6 border-t border-slate-100 flex flex-col md:flex-row justify-between items-center gap-6">
                    <div className="flex gap-3 w-full md:w-auto">
                        {selectedTournament.status === 'planned' && (
                          <button className="btn btn-primary px-8 py-3 shadow-lg shadow-blue-200" onClick={() => handleStart(selectedTournament.tournament_id)}>Start Event Now</button>
                        )}
                        <span className={`chip py-1.5 px-4 h-fit ${selectedTournament.status === 'planned' ? 'bg-blue-50 text-blue-600 border-blue-100' : selectedTournament.status === 'started' ? 'bg-green-50 text-green-600 border-green-100' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                            Status: <span className="uppercase ml-1">{selectedTournament.status}</span>
                        </span>
                    </div>

                    {selectedTournament.status !== 'finished' && (
                      <form className="bg-slate-900 p-6 rounded-2xl border border-slate-800 w-full max-w-lg space-y-4" onSubmit={handleFinish}>
                        <div className="flex justify-between items-center">
                            <h3 className="text-sm font-bold text-white uppercase tracking-widest">Manual Results Entry</h3>
                            <span className="text-[9px] font-bold text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">Admin Only</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <input className="input bg-slate-800 border-slate-700 text-white text-sm focus:ring-blue-500" placeholder="Winner" value={resultForm.winner} onChange={e => setResultForm({...resultForm, winner: e.target.value})} required />
                          <input className="input bg-slate-800 border-slate-700 text-white text-sm focus:ring-blue-500" placeholder="Runner-up" value={resultForm.runner_up} onChange={e => setResultForm({...resultForm, runner_up: e.target.value})} />
                          <input className="input bg-slate-800 border-slate-700 text-white text-sm focus:ring-blue-500" placeholder="3rd Place" value={resultForm.third_place} onChange={e => setResultForm({...resultForm, third_place: e.target.value})} />
                        </div>
                        <div className="flex justify-between items-center pt-2">
                          <p className="text-[10px] text-slate-500 font-medium">Automatic fetching is active for this tournament.</p>
                          <button className="btn btn-primary btn-small px-6" type="submit" disabled={busyAction === 'finish'}>Publish Results</button>
                        </div>
                      </form>
                    )}

                    {selectedTournament.status === 'finished' && (
                        <div className="w-full bg-blue-600 p-6 rounded-2xl shadow-xl shadow-blue-100">
                            <h3 className="text-xs font-bold text-blue-100 uppercase tracking-[0.2em] mb-4">Official Tournament Podium</h3>
                            <div className="grid grid-cols-3 gap-6">
                              {[
                                { l: "Gold", v: selectedTournament.winner, icon: "🥇" },
                                { l: "Silver", v: selectedTournament.runner_up, icon: "🥈" },
                                { l: "Bronze", v: selectedTournament.third_place, icon: "🥉" },
                              ].map(r => (
                                <div key={r.l} className="text-center">
                                  <span className="text-[9px] font-bold text-blue-200 uppercase tracking-widest block mb-1">{r.l}</span>
                                  <div className="text-2xl mb-1">{r.icon}</div>
                                  <strong className="text-sm text-white block truncate">{r.v || "-"}</strong>
                                </div>
                              ))}
                            </div>
                        </div>
                    )}
                  </div>
                </section>
              )}

              {selectedTournament && isEditing && (
                  <section className="card space-y-8 animate-in fade-in zoom-in-95 duration-300">
                      <h2 className="text-xl font-bold text-slate-900 border-b border-slate-100 pb-4 flex justify-between items-center">
                        Edit Tournament
                        <span className="text-[10px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded-md uppercase tracking-widest">Editor Mode</span>
                      </h2>
                      <form className="space-y-6" onSubmit={handleUpdate}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div><label className="label">Name</label><input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></div>
                          <div><label className="label">URL</label><input className="input" value={form.chesscom_link} onChange={e => setForm({...form, chesscom_link: e.target.value})} required /></div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div><label className="label">Format</label><select className="input font-bold" value={form.format} onChange={e => setForm({...form, format: e.target.value})}><option value="Swiss">Swiss</option><option value="Arena">Arena</option></select></div>
                          <div><label className="label">Time Control</label><input className="input" value={form.time_control} onChange={e => setForm({...form, time_control: e.target.value})} /></div>
                          <div><label className="label">Rated</label><div className="flex items-center gap-3 h-10 px-3 bg-white border border-slate-200 rounded-lg"><input type="checkbox" className="w-5 h-5 text-blue-600 rounded cursor-pointer" checked={form.rated} onChange={e => setForm({...form, rated: e.target.checked})} /><span className="text-sm font-bold text-slate-600">{form.rated ? 'Yes' : 'No'}</span></div></div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 bg-slate-50 rounded-2xl border border-slate-100">
                          <div><label className="label">Date</label><input className="input" type="date" value={form.scheduled_date} onChange={e => setForm({...form, scheduled_date: e.target.value})} /></div>
                          <div><label className="label">Time</label><input className="input" type="time" value={form.scheduled_time} onChange={e => setForm({...form, scheduled_time: e.target.value})} /></div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div><label className="label">Description</label><textarea className="input" value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={4} /></div>
                          <div><label className="label">Rules</label><textarea className="input" value={form.rules} onChange={e => setForm({...form, rules: e.target.value})} rows={4} /></div>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-8 items-center pt-6 border-t border-slate-100">
                            <label className="flex items-center gap-3 cursor-pointer select-none"><input type="checkbox" className="w-5 h-5 text-blue-600 rounded" checked={form.is_automated} onChange={e => setForm({...form, is_automated: e.target.checked})} /><span className="text-sm font-bold text-slate-700">Enable Automation</span></label>
                            <label className="flex items-center gap-3"><span className="text-xs font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">Repeat Event</span><select className="input py-1 text-sm font-bold text-blue-600 bg-transparent" value={form.recurrence} onChange={e => setForm({...form, recurrence: e.target.value})}><option value="">None</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
                            <div className="sm:ml-auto flex gap-3 w-full sm:w-auto">
                                <button className="btn btn-primary flex-1 sm:flex-none px-10" type="submit" disabled={busyAction === 'update'}>Update Tournament</button>
                                <button className="btn flex-1 sm:flex-none" type="button" onClick={() => setIsEditing(false)}>Cancel</button>
                            </div>
                        </div>
                    </form>
                  </section>
              )}
            </div>
          )}

          {activeTab === 'users' && (
              <div className="space-y-8 animate-in fade-in duration-400">
                <section className="card p-8">
                    <div className="max-w-3xl mx-auto space-y-6">
                        <div className="text-center space-y-1">
                            <h2 className="text-xl font-bold text-slate-900">Member Verification</h2>
                            <p className="text-sm text-slate-500">Manually link Discord accounts to Chess.com usernames.</p>
                        </div>
                        <form className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-4 p-6 bg-slate-50 rounded-2xl border border-slate-100" onSubmit={handleManualLink}>
                            <div>
                                <label className="label">Discord ID</label>
                                <input className="input" placeholder="e.g. 123456..." value={linkUserForm.discord_id} onChange={e => setLinkUserForm({...linkUserForm, discord_id: e.target.value})} required />
                            </div>
                            <div>
                                <label className="label">Chess.com Username</label>
                                <input className="input" placeholder="magnuscarlsen" value={linkUserForm.chesscom_username} onChange={e => setLinkUserForm({...linkUserForm, chesscom_username: e.target.value})} required />
                            </div>
                            <div className="flex items-end">
                                <button className="btn btn-primary h-10 px-8 w-full" type="submit" disabled={busyAction === 'link'}>Link</button>
                            </div>
                        </form>
                    </div>
                </section>

                <section className="card space-y-6 p-8">
                    <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                        <h2 className="text-lg font-bold text-slate-900">Verified Database</h2>
                        <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-md uppercase tracking-widest">{users.length} Active Links</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {users.length === 0 ? <p className="col-span-full text-center py-16 text-slate-400 border-2 border-dashed border-slate-100 rounded-2xl font-medium">No verified members found.</p> : 
                            users.map(u => (
                                <div key={u.discord_id} className="p-4 rounded-2xl border border-slate-100 bg-white flex justify-between items-center group hover:border-blue-200 hover:shadow-md transition-all">
                                    <div className="min-w-0 pr-4">
                                        <strong className="text-sm text-slate-800 block truncate">{u.chesscom_username}</strong>
                                        <span className="text-[9px] text-slate-400 font-bold font-mono tracking-tighter">ID: {u.discord_id}</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <button className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-50 text-red-500 hover:bg-red-500 hover:text-white transition-colors opacity-0 group-hover:opacity-100" onClick={() => handleUnlink(u.discord_id)} title="Unlink User">
                                            <span className="text-xs">🗑️</span>
                                        </button>
                                    </div>
                                </div>
                            ))
                        }
                    </div>
                </section>
              </div>
          )}

          {activeTab === 'announce' && (
            <div className="space-y-8 animate-in fade-in duration-400">
              <section className="card space-y-6 p-8">
                <div className="flex justify-between items-start border-b border-slate-100 pb-6">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900">Broadcast Center</h2>
                        <p className="text-sm text-slate-500">Reach your community with Discord-styled announcements.</p>
                    </div>
                    <div className="bg-blue-50 text-blue-600 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full border border-blue-100">Live Markdown</div>
                </div>
                
                <form className="space-y-8" onSubmit={handleAnnounce}>
                  <div className="flex flex-col sm:flex-row gap-6">
                    <label className="flex-1">
                      <span className="label">Destination Channel ID</span>
                      <input className="input font-mono" placeholder="Enter Discord Channel ID..." value={announcementForm.channel_id} onChange={e => setAnnouncementForm({...announcementForm, channel_id: e.target.value})} required />
                    </label>
                    <div className="flex gap-4">
                      <label>
                        <span className="label text-blue-600">Schedule Date</span>
                        <input className="input w-40 border-blue-100" type="date" value={announcementForm.scheduled_date} onChange={e => setAnnouncementForm({...announcementForm, scheduled_date: e.target.value})} />
                      </label>
                      <label>
                        <span className="label text-blue-600">Schedule Time</span>
                        <input className="input w-32 border-blue-100" type="time" value={announcementForm.scheduled_time} onChange={e => setAnnouncementForm({...announcementForm, scheduled_time: e.target.value})} />
                      </label>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-full">
                    <div className="space-y-2 flex flex-col h-full">
                      <span className="label">Message Content</span>
                      <textarea className="input font-mono text-sm flex-1 min-h-[400px] resize-none focus:ring-slate-400" placeholder="Use **bold**, *italics*, [links](url), or `code`..." value={announcementForm.message} onChange={e => setAnnouncementForm({...announcementForm, message: e.target.value})} required />
                    </div>
                    <div className="space-y-2 flex flex-col h-full">
                      <span className="label">Discord Simulator Preview</span>
                      <div className="rounded-2xl p-8 bg-[#313338] text-[#dbdee1] flex-1 border border-slate-900 shadow-2xl overflow-auto custom-scrollbar min-h-[400px]">
                        <div className="prose prose-invert prose-sm max-w-none prose-p:my-0 prose-headings:my-2 prose-strong:text-white prose-a:text-[#00a8fc] prose-code:bg-[#2b2d31] prose-code:px-1 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
                          <ReactMarkdown>
                            {announcementForm.message || "_Message preview will be rendered here as you type..._"}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex justify-end pt-4 border-t border-slate-100">
                      <button className="btn btn-primary px-12 py-3 shadow-lg shadow-blue-200" type="submit" disabled={busyAction === 'announce'}>
                        {busyAction === 'announce' ? 'Sending...' : (announcementForm.scheduled_date ? 'Schedule Broadcast' : 'Send Immediately')}
                      </button>
                  </div>
                </form>
              </section>

              <section className="card p-8 space-y-6">
                <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-4 flex items-center gap-2">
                    Broadcast History
                    <span className="text-[10px] font-bold text-slate-300 bg-slate-50 px-2 py-0.5 rounded uppercase">Storage</span>
                </h2>
                <div className="grid grid-cols-1 gap-3">
                  {announcements.length === 0 ? <p className="text-center py-12 text-slate-400 font-medium italic border-2 border-dashed border-slate-50 rounded-2xl">The broadcast queue is empty.</p> : 
                    announcements.map(ann => (
                      <div key={ann.announcement_id} className="flex flex-col sm:flex-row justify-between sm:items-center p-5 rounded-2xl border border-slate-50 bg-slate-50/30 hover:bg-white hover:border-slate-200 hover:shadow-sm transition-all group gap-4">
                        <div className="flex-1 min-w-0 pr-4">
                          <strong className="text-sm text-slate-700 block truncate leading-relaxed">{ann.message}</strong>
                          <div className="flex items-center gap-3 mt-1">
                              <span className="text-[9px] text-slate-400 font-bold uppercase font-mono bg-slate-100 px-1.5 py-0.5 rounded"># {ann.channel_id}</span>
                              <span className="text-[9px] text-slate-300 font-bold uppercase tracking-widest">{formatDate(ann.scheduled_for)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <span className={`chip h-fit py-1 px-3 border-none ${ann.sent ? 'bg-slate-200/50 text-slate-500' : 'bg-blue-600 text-white shadow-sm'}`}>
                            {ann.sent ? 'Delivered' : 'Scheduled'}
                          </span>
                          {!ann.sent && <button className="btn btn-small btn-danger bg-white border-red-100 hover:bg-red-500 hover:text-white" onClick={() => handleDeleteAnnouncement(ann.announcement_id)}>Cancel</button>}
                        </div>
                      </div>
                    ))
                  }
                </div>
              </section>
            </div>
          )}

          {activeTab === 'create' && (
            <section className="card p-10 animate-in slide-in-from-bottom-8 duration-600">
              <div className="text-center mb-10 max-w-xl mx-auto space-y-2">
                  <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Schedule Tournament</h2>
                  <p className="text-slate-500">Create a new event record. Automated events will start and conclude based on the official Chess.com timing.</p>
              </div>
              
              <form className="space-y-8" onSubmit={handleCreate}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-1.5"><label className="label">Display Name</label><input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required placeholder="e.g. Monthly Club Championship" /></div>
                  <div className="space-y-1.5"><label className="label">Chess.com URL</label><input className="input" value={form.chesscom_link} onChange={e => setForm({...form, chesscom_link: e.target.value})} required placeholder="https://www.chess.com/tournament/live/..." /></div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  <div className="space-y-1.5"><label className="label">Format Type</label><select className="input font-bold" value={form.format} onChange={e => setForm({...form, format: e.target.value})}><option value="Swiss">Swiss Tournament</option><option value="Arena">Arena Match</option></select></div>
                  <div className="space-y-1.5"><label className="label">Time Control</label><input className="input" value={form.time_control} onChange={e => setForm({...form, time_control: e.target.value})} placeholder="3+2, 10 min, etc." /></div>
                  <div className="space-y-1.5"><label className="label">Rated</label><div className="flex items-center gap-3 h-11 px-4 bg-white border border-slate-200 rounded-lg cursor-pointer hover:border-blue-300 transition-colors" onClick={() => setForm({...form, rated: !form.rated})}><input type="checkbox" className="w-5 h-5 text-blue-600 rounded" checked={form.rated} onChange={() => {}} readOnly /><span className="text-sm font-bold text-slate-700">{form.rated ? 'Official Rated' : 'Friendly/Casual'}</span></div></div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 p-8 bg-blue-50/30 rounded-3xl border border-blue-50">
                  <div className="space-y-1.5"><label className="label text-blue-600">Start Date</label><input className="input border-blue-100 shadow-sm" type="date" value={form.scheduled_date} onChange={e => setForm({...form, scheduled_date: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="label text-blue-600">Start Time (UTC)</label><input className="input border-blue-100 shadow-sm" type="time" value={form.scheduled_time} onChange={e => setForm({...form, scheduled_time: e.target.value})} /></div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-1.5"><label className="label">Public Description</label><textarea className="input" value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Shared with players in announcements..." rows={4} /></div>
                  <div className="space-y-1.5"><label className="label">Staff Notes</label><textarea className="input" value={form.rules} onChange={e => setForm({...form, rules: e.target.value})} placeholder="Internal rules or management notes..." rows={4} /></div>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-10 items-center pt-8 border-t border-slate-100">
                    <label className="flex items-center gap-3 bg-blue-600 px-5 py-3 rounded-2xl cursor-pointer shadow-lg shadow-blue-100 group transition-all hover:scale-[1.02]">
                        <input type="checkbox" className="w-6 h-6 text-blue-700 bg-white border-none rounded-lg cursor-pointer" checked={form.is_automated} onChange={e => setForm({...form, is_automated: e.target.checked})} />
                        <span className="text-xs font-bold text-white uppercase tracking-widest">Enable AI Automation Engine</span>
                    </label>
                    <label className="flex items-center gap-3"><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">Recurrence</span><select className="input border-none bg-slate-100 py-2 px-4 text-xs font-bold text-slate-600 rounded-full" value={form.recurrence} onChange={e => setForm({...form, recurrence: e.target.value})}><option value="">None (One-time)</option><option value="daily">Daily Event</option><option value="weekly">Weekly Event</option><option value="monthly">Monthly Event</option></select></label>
                    <button className="btn btn-primary sm:ml-auto px-12 py-4 text-base shadow-xl shadow-blue-200" type="submit" disabled={busyAction === 'create'}>Deploy Tournament</button>
                </div>
              </form>
            </section>
          )}

          {activeTab === 'settings' && (
            <div className="space-y-8 animate-in fade-in duration-400 max-w-5xl">
                <section className="card p-10 space-y-10">
                    <div className="border-b border-slate-100 pb-6 flex justify-between items-end">
                        <div className="space-y-1">
                            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">System Configuration</h2>
                            <p className="text-sm text-slate-500 font-medium">Global parameters for bot integration and club synchronization.</p>
                        </div>
                        <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Master Key Required</span>
                    </div>
                    
                    <form className="space-y-10" onSubmit={handleUpdateSettings}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                            <div className="space-y-2"><label className="label">Discord Server (Guild) ID</label><input className="input font-mono text-sm tracking-widest" value={appSettings.discord_guild_id} onChange={e => setAppSettings({...appSettings, discord_guild_id: e.target.value})} placeholder="000000000000000000" /></div>
                            <div className="space-y-2"><label className="label">Chess.com Club ID</label><input className="input font-mono text-sm tracking-widest" value={appSettings.chesscom_club_id} onChange={e => setAppSettings({...appSettings, chesscom_club_id: e.target.value})} placeholder="e.g. club-name-identifier" /></div>
                        </div>
                        
                        <div className="p-8 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-8">
                          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2"><span className="w-4 h-[1px] bg-slate-200"></span> Channel Routing <span className="w-4 h-[1px] bg-slate-200"></span></h3>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            <div className="space-y-2"><label className="label text-[10px]">Announcements</label><input className="input font-mono text-xs bg-white" value={appSettings.discord_announcement_channel_id} onChange={e => setAppSettings({...appSettings, discord_announcement_channel_id: e.target.value})} /></div>
                            <div className="space-y-2"><label className="label text-[10px]">Results</label><input className="input font-mono text-xs bg-white" value={appSettings.discord_results_channel_id} onChange={e => setAppSettings({...appSettings, discord_results_channel_id: e.target.value})} /></div>
                            <div className="space-y-2"><label className="label text-[10px]">Daily Puzzles</label><input className="input font-mono text-xs bg-white" value={appSettings.discord_puzzle_channel_id} onChange={e => setAppSettings({...appSettings, discord_puzzle_channel_id: e.target.value})} /></div>
                          </div>
                        </div>

                        <div className="p-8 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-8">
                          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2"><span className="w-4 h-[1px] bg-slate-200"></span> Role Permissions <span className="w-4 h-[1px] bg-slate-200"></span></h3>
                          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                            <div className="space-y-2 col-span-1 md:col-span-1"><label className="label text-[10px]">Mention Role</label><input className="input font-mono text-xs bg-white" value={appSettings.discord_players_role_id} onChange={e => setAppSettings({...appSettings, discord_players_role_id: e.target.value})} /></div>
                            <div className="space-y-2 col-span-1 md:col-span-1"><label className="label text-[10px]">Verified Role</label><input className="input font-mono text-xs bg-white" value={appSettings.discord_verified_role_id} onChange={e => setAppSettings({...appSettings, discord_verified_role_id: e.target.value})} /></div>
                            <div className="space-y-2 col-span-1 md:col-span-1"><label className="label text-[10px]">Champion Role</label><input className="input font-mono text-xs bg-white" value={appSettings.discord_champion_role_id} onChange={e => setAppSettings({...appSettings, discord_champion_role_id: e.target.value})} /></div>
                          </div>
                        </div>

                        <div className="flex pt-4">
                            <button className="btn btn-primary px-16 py-4 text-base shadow-xl shadow-blue-100" type="submit" disabled={busyAction === 'settings'}>
                                {busyAction === 'settings' ? 'Processing Updates...' : 'Commit All Config Changes'}
                            </button>
                        </div>
                    </form>
                </section>
                
                <section className="bg-white p-10 rounded-3xl border border-red-100 space-y-6 shadow-sm">
                    <div className="flex items-center gap-3 text-red-600">
                        <span className="text-2xl">⚠️</span>
                        <h2 className="text-xl font-bold tracking-tight">Factory Reset</h2>
                    </div>
                    <p className="text-sm text-slate-500 font-medium leading-relaxed max-w-2xl">This will permanently delete all tournament data, linked user records, and announcement history. This operation is non-reversible and will disconnect all linked community members.</p>
                    <button className="btn border-red-100 text-red-600 font-bold bg-red-50 hover:bg-red-600 hover:text-white transition-all px-8" onClick={handleNuke}>Purge System Database</button>
                </section>
            </div>
          )}
        </main>
      </div>

      <div className="fixed bottom-8 right-8 space-y-3 z-[100] max-w-xs w-full pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className={`pointer-events-auto px-6 py-4 rounded-2xl shadow-2xl border flex items-center gap-3 text-sm font-bold animate-in slide-in-from-right-full duration-500 ${t.type === 'error' ? 'bg-red-600 border-red-700 text-white' : 'bg-slate-900 border-slate-800 text-white'}`}>
            <span className="shrink-0">{t.type === 'error' ? '❌' : '✅'}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
