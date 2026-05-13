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
      const scheduled_for = form.scheduled_date && form.scheduled_time ? new Date(`${form.scheduled_date}T${form.scheduled_time}Z`).toISOString() : null;
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
      const scheduled_for = form.scheduled_date && form.scheduled_time ? new Date(`${form.scheduled_date}T${form.scheduled_time}Z`).toISOString() : null;
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
        const scheduled_for = new Date(`${announcementForm.scheduled_date}T${announcementForm.scheduled_time}Z`).toISOString();
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

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  if (authLoading) return <div className="min-h-screen flex items-center justify-center bg-chess-black"><div className="text-chess-green font-mono animate-pulse uppercase tracking-[0.3em]">System Initializing...</div></div>;

  if (!token || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-chess-black p-6 font-mono">
        <section className="card max-w-md w-full p-10 border-chess-green/50">
          <p className="text-[10px] font-bold text-chess-green/40 uppercase tracking-[0.4em] mb-4 text-center">Security Gateway</p>
          <h1 className="text-xl font-bold text-chess-green mb-10 text-center tracking-tighter">ADMIN_ACCESS_REQUIRED</h1>
          <form className="space-y-6" onSubmit={handleLogin}>
            <div className="space-y-2">
              <label className="label">Encryption Key</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            {loginError && <p className="text-xs text-chess-red font-mono">{`[ERROR]: ${loginError}`}</p>}
            <button className="btn btn-primary w-full py-4 uppercase tracking-widest text-xs" type="submit" disabled={busyAction === "login"}>Execute Login</button>
          </form>
        </section>
      </div>
    );
  }

  const TabButton = ({ id, label, icon }) => (
    <button 
      className={`nav-item flex items-center gap-3 text-xs font-bold uppercase tracking-widest ${activeTab === id ? 'nav-item-active' : ''}`} 
      onClick={() => { setActiveTab(id); setIsMobileMenuOpen(false); }}
    >
      <span className="opacity-50">{icon}</span>
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-chess-black flex flex-col font-mono text-chess-green">
      <header className="bg-chess-dark border-b border-chess-gray px-6 py-4 sticky top-0 z-50 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <button className="lg:hidden text-chess-green" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
            {isMobileMenuOpen ? '✕' : '☰'}
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-chess-green text-chess-black flex items-center justify-center font-bold text-xs">C</div>
            <h1 className="text-sm font-bold tracking-tighter hidden sm:block">CHESS_CLUB_OS</h1>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[10px] text-chess-green/40 hidden md:block">USER: {user.username}</span>
          <button className="btn btn-small border-chess-red text-chess-red hover:bg-chess-red hover:text-chess-black" onClick={handleLogout}>Terminate_Session</button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className={`
          fixed inset-0 z-40 bg-chess-black lg:static lg:block lg:w-[240px] border-r border-chess-gray transition-transform duration-300
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}>
          <div className="p-4 space-y-1 mt-16 lg:mt-0">
            <TabButton id="overview" label="Monitor" icon="01" />
            <TabButton id="tournaments" label="Events" icon="02" />
            <TabButton id="users" label="Network" icon="03" />
            <TabButton id="announce" label="Broadcast" icon="04" />
            <TabButton id="create" label="Deploy" icon="05" />
            <TabButton id="settings" label="Config" icon="06" />
          </div>
          <div className="absolute bottom-6 left-6 text-[9px] text-chess-green/20 font-bold uppercase tracking-[0.2em]">
            SYSTEM_STABLE_V2.0
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-10 space-y-10">
          {activeTab === 'overview' && (
            <div className="space-y-10 animate-in fade-in duration-700">
              <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                  { label: "Total_Nodes", val: stats.total, color: "text-chess-green", icon: "[ALL]" },
                  { label: "Awaiting", val: stats.planned, color: "text-chess-green/60", icon: "[PLN]" },
                  { label: "Active_Running", val: stats.started, color: "text-chess-green", icon: "[ACT]" },
                  { label: "Completed", val: stats.finished, color: "text-chess-green/30", icon: "[FIN]" },
                ].map(s => (
                  <div key={s.label} className="card p-6 group hover:border-chess-green transition-colors">
                    <div className="flex justify-between items-start mb-4">
                        <span className="text-[9px] font-bold text-chess-green/40 uppercase tracking-[0.2em]">{s.label}</span>
                        <span className="text-[9px] text-chess-green/20">{s.icon}</span>
                    </div>
                    <div className={`text-4xl font-bold tracking-tighter ${s.color}`}>{s.val}</div>
                  </div>
                ))}
              </section>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
                <section className="card p-8 space-y-8">
                  <div className="flex justify-between items-end border-b border-chess-gray pb-4">
                    <h2 className="text-sm font-bold tracking-widest uppercase flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-chess-green"></span> Live_Leaderboard
                    </h2>
                    <span className="text-[9px] text-chess-green/30 tracking-[0.2em]">TOP_10_NODES</span>
                  </div>
                  <div className="space-y-3">
                    {leaderboard.length === 0 ? (
                      <p className="text-xs text-chess-green/20 italic py-8 text-center border border-dashed border-chess-gray">No win data synchronized...</p>
                    ) : (
                      leaderboard.map((item, index) => (
                        <div key={item.username} className="flex justify-between items-center group p-2 hover:bg-chess-gray/30 transition-colors">
                          <div className="flex items-center gap-4">
                            <span className="text-[9px] text-chess-green/30 font-mono w-4">{String(index + 1).padStart(2, '0')}</span>
                            <span className="text-xs font-bold tracking-tight">{item.username}</span>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="h-1 hidden sm:block bg-chess-gray w-32 group-hover:bg-chess-green/10 transition-colors">
                              <div className="h-full bg-chess-green/60 group-hover:bg-chess-green" style={{ width: `${(item.wins / Math.max(...leaderboard.map(l => l.wins))) * 100}%` }}></div>
                            </div>
                            <span className="text-xs font-bold w-6 text-right text-chess-green">{item.wins}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                <section className="card p-8 space-y-8">
                    <div className="flex justify-between items-end border-b border-chess-gray pb-4">
                        <h2 className="text-sm font-bold tracking-widest uppercase flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-chess-green/50"></span> Priority_Queue
                        </h2>
                        <button className="text-[9px] text-chess-green/40 hover:text-chess-green transition-colors tracking-widest" onClick={() => setActiveTab('tournaments')}>BROWSE_ALL</button>
                    </div>
                    <div className="space-y-3">
                        {tournaments.filter(t => t.status === 'planned').length === 0 ? (
                          <p className="text-xs text-chess-green/20 italic py-8 text-center border border-dashed border-chess-gray">Queue is currently empty...</p>
                        ) : (
                          tournaments.filter(t => t.status === 'planned').slice(0, 5).map(t => (
                            <div key={t.tournament_id} className="flex justify-between items-center text-xs p-3 border border-chess-gray bg-chess-black hover:border-chess-green/30 transition-all">
                                <div className="space-y-1 min-w-0 pr-4">
                                    <p className="font-bold truncate">{t.name}</p>
                                    <p className="text-[9px] text-chess-green/30 uppercase tracking-[0.2em]">{formatDate(t.scheduled_for)}</p>
                                </div>
                                <span className="chip border-chess-green/20 text-chess-green/40 shrink-0">
                                    PLANNED
                                </span>
                            </div>
                          ))
                        )}
                    </div>
                </section>
              </div>
            </div>
          )}

          {activeTab === 'tournaments' && (
            <div className="space-y-10 animate-in fade-in duration-500">
              <section className="card space-y-6 p-6">
                <div className="flex flex-col md:flex-row gap-6">
                  <div className="relative flex-1">
                    <input className="input pl-10" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="SEARCH_BY_ID_OR_NAME..." />
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-chess-green/30 text-xs">SCAN</span>
                  </div>
                  <select className="input md:w-56" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="">FILTER: ALL_STATUS</option>
                    <option value="planned">STATUS: PLANNED</option>
                    <option value="started">STATUS: ACTIVE</option>
                    <option value="finished">STATUS: COMPLETE</option>
                  </select>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {listLoading ? <div className="col-span-full py-20 flex flex-col items-center gap-4 text-chess-green/40"><div className="w-6 h-6 border-2 border-chess-green/10 border-t-chess-green animate-spin"></div><span className="text-[10px] uppercase tracking-widest">Accessing_Data...</span></div> : 
                    tournaments.map(t => (
                      <button 
                        key={t.tournament_id} 
                        className={`text-left p-4 border transition-all ${selectedId === t.tournament_id ? 'border-chess-green bg-chess-green/5 shadow-[0_0_15px_rgba(0,255,65,0.1)]' : 'border-chess-gray hover:border-chess-green/40'}`} 
                        onClick={() => { setSelectedId(t.tournament_id); setIsEditing(false); }}
                      >
                        <div className="flex justify-between items-start mb-4">
                          <strong className="text-xs font-bold line-clamp-1 flex-1 mr-2 uppercase tracking-tight">{t.name}</strong>
                          <span className={`chip ${t.status === 'planned' ? 'border-chess-green/20 text-chess-green/40' : t.status === 'started' ? 'border-chess-green text-chess-green shadow-[0_0_8px_rgba(0,255,65,0.2)]' : 'border-chess-gray text-chess-green/20'}`}>
                            {t.status}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[9px] font-mono tracking-tighter">
                          <span className="text-chess-green/30">{t.tournament_id}</span>
                          <span className="text-chess-green/50">{formatDate(t.scheduled_for).split(',')[0]}</span>
                        </div>
                      </button>
                    ))
                  }
                </div>
              </section>

              {selectedTournament && !isEditing && (
                <section className="card p-8 space-y-10 animate-in slide-in-from-bottom-4 duration-500 border-chess-green/30">
                  <div className="flex flex-col sm:flex-row justify-between items-start gap-6 border-b border-chess-gray pb-8">
                    <div className="space-y-2">
                      <h2 className="text-2xl font-bold tracking-tighter uppercase">{selectedTournament.name}</h2>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-mono text-chess-green/40">{selectedTournament.tournament_id}</span>
                        <span className="w-1 h-1 bg-chess-gray"></span>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-chess-green/60">{selectedTournament.status}</span>
                      </div>
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
              <div className="space-y-10 animate-in fade-in duration-500">
                <section className="card p-8">
                    <div className="max-w-3xl mx-auto space-y-8">
                        <div className="text-center space-y-2">
                            <h2 className="text-xl font-bold tracking-tighter uppercase">Network_Verification</h2>
                            <p className="text-xs text-chess-green/40 uppercase tracking-widest">Link Discord_ID to Chess.com_Handshake</p>
                        </div>
                        <form className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-6 p-8 border border-chess-gray bg-chess-black" onSubmit={handleManualLink}>
                            <div className="space-y-2">
                                <label className="label">Discord_Node_ID</label>
                                <input className="input" placeholder="000000000000000000" value={linkUserForm.discord_id} onChange={e => setLinkUserForm({...linkUserForm, discord_id: e.target.value})} required />
                            </div>
                            <div className="space-y-2">
                                <label className="label">Chess.com_Handle</label>
                                <input className="input" placeholder="ID_ALPHA" value={linkUserForm.chesscom_username} onChange={e => setLinkUserForm({...linkUserForm, chesscom_username: e.target.value})} required />
                            </div>
                            <div className="flex items-end">
                                <button className="btn btn-primary h-11 px-10 w-full text-xs" type="submit" disabled={busyAction === 'link'}>ESTABLISH_LINK</button>
                            </div>
                        </form>
                    </div>
                </section>

                <section className="card space-y-8 p-8">
                    <div className="flex justify-between items-center border-b border-chess-gray pb-6">
                        <h2 className="text-sm font-bold tracking-widest uppercase flex items-center gap-3">
                          <span className="w-1.5 h-1.5 bg-chess-green"></span> Verified_Directory
                        </h2>
                        <span className="text-[9px] font-bold text-chess-green/30 border border-chess-gray px-3 py-1 uppercase tracking-widest">{users.length} Active_Links</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {users.length === 0 ? <p className="col-span-full text-center py-20 text-chess-green/20 border border-dashed border-chess-gray font-mono text-xs uppercase tracking-widest">No verified members detected in database.</p> : 
                            users.map(u => (
                                <div key={u.discord_id} className="p-5 border border-chess-gray bg-chess-black flex justify-between items-center group hover:border-chess-green/40 transition-all">
                                    <div className="min-w-0 pr-4 space-y-1">
                                        <strong className="text-sm font-bold block truncate uppercase tracking-tight">{u.chesscom_username}</strong>
                                        <span className="text-[9px] text-chess-green/30 font-mono block">UID: {u.discord_id}</span>
                                    </div>
                                    <button className="w-8 h-8 flex items-center justify-center border border-chess-red/30 text-chess-red hover:bg-chess-red hover:text-chess-black transition-colors opacity-0 group-hover:opacity-100" onClick={() => handleUnlink(u.discord_id)} title="Unlink User">
                                        <span className="text-xs">✕</span>
                                    </button>
                                </div>
                            ))
                        }
                    </div>
                </section>
              </div>
          )}

          {activeTab === 'announce' && (
            <div className="space-y-10 animate-in fade-in duration-500">
              <section className="card p-8 space-y-8">
                <div className="flex justify-between items-start border-b border-chess-gray pb-6">
                    <div className="space-y-2">
                        <h2 className="text-xl font-bold tracking-tighter uppercase">Broadcast_Link</h2>
                        <p className="text-xs text-chess-green/40 uppercase tracking-widest">Transmit Encrypted Markdown to Network Channels</p>
                    </div>
                    <div className="bg-chess-green/5 text-chess-green text-[9px] font-bold uppercase tracking-widest px-4 py-2 border border-chess-green/20">LIVE_SYNTAX_PARSER</div>
                </div>
                
                <form className="space-y-10" onSubmit={handleAnnounce}>
                  <div className="flex flex-col lg:flex-row gap-8">
                    <div className="flex-1 space-y-2">
                      <label className="label">Target_Channel_ID</label>
                      <input className="input" placeholder="000000000000000000" value={announcementForm.channel_id} onChange={e => setAnnouncementForm({...announcementForm, channel_id: e.target.value})} required />
                    </div>
                    <div className="flex flex-col sm:flex-row gap-6">
                      <div className="space-y-2">
                        <label className="label">Transmission_Date</label>
                        <input className="input" type="date" value={announcementForm.scheduled_date} onChange={e => setAnnouncementForm({...announcementForm, scheduled_date: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <label className="label">Transmission_Time</label>
                        <input className="input" type="time" value={announcementForm.scheduled_time} onChange={e => setAnnouncementForm({...announcementForm, scheduled_time: e.target.value})} />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
                    <div className="space-y-3">
                      <span className="label">Payload_Input</span>
                      <textarea className="input text-xs min-h-[400px] leading-relaxed resize-none focus:border-chess-green" placeholder="INPUT_MARKDOWN_HERE..." value={announcementForm.message} onChange={e => setAnnouncementForm({...announcementForm, message: e.target.value})} required />
                    </div>
                    <div className="space-y-3">
                      <span className="label">Transmission_Preview</span>
                      <div className="border border-chess-gray p-8 bg-chess-dark text-chess-green/80 min-h-[400px] overflow-auto">
                        <div className="prose prose-invert prose-xs max-w-none prose-p:my-0 prose-strong:text-chess-green prose-a:text-chess-green prose-a:underline prose-code:text-chess-green prose-code:bg-chess-black prose-code:px-1">
                          <ReactMarkdown>
                            {announcementForm.message || "// NO_PAYLOAD_DETECTED..."}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex justify-end pt-8 border-t border-chess-gray">
                      <button className="btn btn-primary px-12 py-4 text-xs uppercase tracking-widest" type="submit" disabled={busyAction === 'announce'}>
                        {busyAction === 'announce' ? 'UPLOADING...' : (announcementForm.scheduled_date ? 'QUEUE_BROADCAST' : 'EXECUTE_IMMEDIATE')}
                      </button>
                  </div>
                </form>
              </section>

              <section className="card p-8 space-y-8">
                <div className="flex justify-between items-center border-b border-chess-gray pb-6">
                    <h2 className="text-sm font-bold tracking-widest uppercase flex items-center gap-3">
                      <span className="w-1.5 h-1.5 bg-chess-green/30"></span> Transmission_Logs
                    </h2>
                    <span className="text-[9px] text-chess-green/20 uppercase tracking-widest">LOCAL_CACHE</span>
                </div>
                <div className="space-y-4">
                  {announcements.length === 0 ? <p className="text-center py-20 text-chess-green/20 border border-dashed border-chess-gray font-mono text-xs uppercase tracking-widest">No active transmissions in queue.</p> : 
                    announcements.map(ann => (
                      <div key={ann.announcement_id} className="p-6 border border-chess-gray bg-chess-black flex flex-col sm:flex-row justify-between sm:items-center group gap-6 hover:border-chess-green/20 transition-all">
                        <div className="flex-1 min-w-0 space-y-2">
                          <strong className="text-xs font-bold block truncate tracking-tight uppercase">{ann.message}</strong>
                          <div className="flex items-center gap-4">
                              <span className="text-[9px] text-chess-green/40 font-mono">NODE: {ann.channel_id}</span>
                              <span className="w-1 h-1 bg-chess-gray"></span>
                              <span className="text-[9px] text-chess-green/20 font-bold uppercase tracking-widest">{formatDate(ann.scheduled_for)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-6">
                          <span className={`text-[9px] font-bold uppercase tracking-[0.2em] ${ann.sent ? 'text-chess-green/20' : 'text-chess-green shadow-[0_0_8px_rgba(0,255,65,0.1)]'}`}>
                            {ann.sent ? 'DELIVERED' : 'PENDING'}
                          </span>
                          {!ann.sent && <button className="w-8 h-8 flex items-center justify-center border border-chess-red/30 text-chess-red hover:bg-chess-red hover:text-chess-black transition-colors" onClick={() => handleDeleteAnnouncement(ann.announcement_id)}>✕</button>}
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
              <div className="text-center mb-12 max-w-xl mx-auto space-y-4">
                  <h2 className="text-3xl font-bold tracking-tighter uppercase">DEPLOY_NEW_NODE</h2>
                  <p className="text-xs text-chess-green/40 uppercase tracking-[0.2em]">Initialize a new tournament event across the network.</p>
              </div>
              
              <form className="space-y-10" onSubmit={handleCreate}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2"><label className="label">Event_Codename</label><input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required placeholder="NODE_ALPHA_CHAMPIONSHIP" /></div>
                  <div className="space-y-2"><label className="label">Chess.com_Reference_URL</label><input className="input" value={form.chesscom_link} onChange={e => setForm({...form, chesscom_link: e.target.value})} required placeholder="HTTPS://WWW.CHESS.COM/TOURNAMENT/LIVE/..." /></div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  <div className="space-y-2"><label className="label">Access_Protocol</label><select className="input" value={form.format} onChange={e => setForm({...form, format: e.target.value})}><option value="Swiss">SWISS_MODE</option><option value="Arena">ARENA_MODE</option></select></div>
                  <div className="space-y-2"><label className="label">Temporal_Control</label><input className="input" value={form.time_control} onChange={e => setForm({...form, time_control: e.target.value})} placeholder="3+2, 10 min, etc." /></div>
                  <div className="space-y-2"><label className="label">Verification_Status</label><div className="flex items-center gap-4 h-11 px-4 border border-chess-gray bg-chess-black cursor-pointer hover:border-chess-green/40 transition-colors" onClick={() => setForm({...form, rated: !form.rated})}><input type="checkbox" className="w-4 h-4 border-chess-green bg-transparent text-chess-green rounded-none" checked={form.rated} onChange={() => {}} readOnly /><span className="text-[10px] font-bold uppercase tracking-widest">{form.rated ? 'OFFICIAL_RATED' : 'CASUAL_PROTOCOL'}</span></div></div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 p-8 border border-chess-green/20 bg-chess-green/5">
                  <div className="space-y-2"><label className="label">Activation_Date (UTC)</label><input className="input" type="date" value={form.scheduled_date} onChange={e => setForm({...form, scheduled_date: e.target.value})} /></div>
                  <div className="space-y-2"><label className="label">Activation_Time (UTC)</label><input className="input" type="time" value={form.scheduled_time} onChange={e => setForm({...form, scheduled_time: e.target.value})} /></div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-2"><label className="label">Public_Description</label><textarea className="input" value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="BROADCAST_METADATA..." rows={4} /></div>
                  <div className="space-y-2"><label className="label">Internal_Log_Notes</label><textarea className="input" value={form.rules} onChange={e => setForm({...form, rules: e.target.value})} placeholder="INTERNAL_RULES_DATA..." rows={4} /></div>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-10 items-center pt-8 border-t border-chess-gray">
                    <label className="flex items-center gap-4 cursor-pointer group">
                        <input type="checkbox" className="w-5 h-5 border-chess-green bg-transparent text-chess-green rounded-none cursor-pointer" checked={form.is_automated} onChange={e => setForm({...form, is_automated: e.target.checked})} />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-chess-green group-hover:underline">ACTIVATE_AI_AUTOMATION</span>
                    </label>
                    <label className="flex items-center gap-4"><span className="text-[9px] font-bold text-chess-green/40 uppercase tracking-widest">Recurrence_Interval</span><select className="input border-none bg-chess-gray py-2 px-6 text-[10px] font-bold uppercase rounded-none" value={form.recurrence} onChange={e => setForm({...form, recurrence: e.target.value})}><option value="">NULL</option><option value="daily">DAILY_CYC</option><option value="weekly">WEEKLY_CYC</option><option value="monthly">MONTHLY_CYC</option></select></label>
                    <button className="btn btn-primary sm:ml-auto px-16 py-4 text-xs uppercase tracking-[0.2em]" type="submit" disabled={busyAction === 'create'}>EXECUTE_DEPLOYMENT</button>
                </div>
              </form>
            </section>
          )}

          {activeTab === 'settings' && (
            <div className="space-y-10 animate-in fade-in duration-500 max-w-5xl">
                <section className="card p-10 space-y-12">
                    <div className="border-b border-chess-gray pb-6 flex justify-between items-end">
                        <div className="space-y-2">
                            <h2 className="text-2xl font-bold tracking-tighter uppercase">CORE_CONFIGURATION</h2>
                            <p className="text-xs text-chess-green/40 uppercase tracking-widest">Global system parameters and network routing.</p>
                        </div>
                        <span className="text-[10px] font-bold text-chess-red bg-chess-red/10 border border-chess-red/30 px-3 py-1 uppercase tracking-widest">ENCRYPTION_ACTIVE</span>
                    </div>
                    
                    <form className="space-y-12" onSubmit={handleUpdateSettings}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                            <div className="space-y-3"><label className="label">Guild_Node_ID</label><input className="input" value={appSettings.discord_guild_id} onChange={e => setAppSettings({...appSettings, discord_guild_id: e.target.value})} placeholder="000000000000000000" /></div>
                            <div className="space-y-3"><label className="label">Chess.com_Club_ID</label><input className="input" value={appSettings.chesscom_club_id} onChange={e => setAppSettings({...appSettings, chesscom_club_id: e.target.value})} placeholder="CLUB_HANDLE" /></div>
                        </div>
                        
                        <div className="p-8 border border-chess-gray bg-chess-black space-y-10">
                          <h3 className="text-[9px] font-bold text-chess-green uppercase tracking-[0.4em] flex items-center gap-4"><span className="h-[1px] bg-chess-gray flex-1"></span> CHANNEL_ROUTING <span className="h-[1px] bg-chess-gray flex-1"></span></h3>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            <div className="space-y-3"><label className="label text-chess-green/40">ANNOUNCE_PATH</label><input className="input text-xs" value={appSettings.discord_announcement_channel_id} onChange={e => setAppSettings({...appSettings, discord_announcement_channel_id: e.target.value})} /></div>
                            <div className="space-y-3"><label className="label text-chess-green/40">RESULTS_PATH</label><input className="input text-xs" value={appSettings.discord_results_channel_id} onChange={e => setAppSettings({...appSettings, discord_results_channel_id: e.target.value})} /></div>
                            <div className="space-y-3"><label className="label text-chess-green/40">PUZZLE_PATH</label><input className="input text-xs" value={appSettings.discord_puzzle_channel_id} onChange={e => setAppSettings({...appSettings, discord_puzzle_channel_id: e.target.value})} /></div>
                          </div>
                        </div>

                        <div className="p-8 border border-chess-gray bg-chess-black space-y-10">
                          <h3 className="text-[9px] font-bold text-chess-green uppercase tracking-[0.4em] flex items-center gap-4"><span className="h-[1px] bg-chess-gray flex-1"></span> PERMISSION_NODES <span className="h-[1px] bg-chess-gray flex-1"></span></h3>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            <div className="space-y-3"><label className="label text-chess-green/40">MENTION_ROLE</label><input className="input text-xs" value={appSettings.discord_players_role_id} onChange={e => setAppSettings({...appSettings, discord_players_role_id: e.target.value})} /></div>
                            <div className="space-y-3"><label className="label text-chess-green/40">VERIFIED_ROLE</label><input className="input text-xs" value={appSettings.discord_verified_role_id} onChange={e => setAppSettings({...appSettings, discord_verified_role_id: e.target.value})} /></div>
                            <div className="space-y-3"><label className="label text-chess-green/40">CHAMPION_ROLE</label><input className="input text-xs" value={appSettings.discord_champion_role_id} onChange={e => setAppSettings({...appSettings, discord_champion_role_id: e.target.value})} /></div>
                          </div>
                        </div>

                        <div className="flex pt-6">
                            <button className="btn btn-primary px-20 py-5 text-xs uppercase tracking-widest shadow-[0_0_20px_rgba(0,255,65,0.1)]" type="submit" disabled={busyAction === 'settings'}>
                                {busyAction === 'settings' ? 'SYNCHRONIZING...' : 'COMMIT_GLOBAL_CHANGES'}
                            </button>
                        </div>
                    </form>
                </section>
                
                <section className="p-10 border border-chess-red/20 bg-chess-red/5 space-y-6">
                    <div className="flex items-center gap-4 text-chess-red">
                        <span className="text-xl">⚠️</span>
                        <h2 className="text-xl font-bold tracking-tighter uppercase">SYSTEM_PURGE</h2>
                    </div>
                    <p className="text-xs text-chess-red/60 leading-relaxed max-w-2xl font-mono uppercase">CRITICAL: This operation will permanently erase all nodes, verified links, and transmission history from the central database. This action is irreversible.</p>
                    <button className="btn border-chess-red text-chess-red font-bold hover:bg-chess-red hover:text-chess-black px-10 py-3 text-[10px]" onClick={handleNuke}>INITIATE_FULL_PURGE</button>
                </section>
            </div>
          )}
        </main>
      </div>

      <div className="fixed bottom-8 right-8 space-y-4 z-[100] max-w-xs w-full pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className={`pointer-events-auto px-6 py-4 border flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest animate-in slide-in-from-right-full duration-500 shadow-2xl ${t.type === 'error' ? 'bg-chess-red border-chess-red text-chess-black' : 'bg-chess-green border-chess-green text-chess-black'}`}>
            <span className="shrink-0">{t.type === 'error' ? '[ERROR]' : '[OK]'}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
