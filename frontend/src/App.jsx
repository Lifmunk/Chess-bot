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
  fetchTournamentInfo,
  getUsers,
  linkUser,
  unlinkUser,
  announce,
  listAnnouncements,
  scheduleAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  sendAnnouncementNow,
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
    discord_opening_channel_id: "",
    discord_greeting_channel_id: "",
    bot_greeting_message: "",
    discord_players_role_id: "",
    discord_verified_role_id: "",
    discord_champion_role_id: "",
    chesscom_club_id: "",
  });
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [form, setForm] = useState({ ...emptyForm, reannounce: false });
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

  async function handleFetchDetails() {
    if (!form.chesscom_link) {
      notify("Please enter a Chess.com tournament link first", "error");
      return;
    }
    setBusyAction("fetch-details");
    try {
      const data = await fetchTournamentInfo(token, form.chesscom_link);
      const dt = data.scheduled_for ? new Date(data.scheduled_for) : null;
      setForm({
        ...form,
        name: data.name || form.name,
        format: data.format || form.format,
        time_control: data.time_control || form.time_control,
        rated: data.rated !== undefined ? data.rated : form.rated,
        description: data.description || form.description,
        scheduled_date: dt ? dt.toISOString().split('T')[0] : form.scheduled_date,
        scheduled_time: dt ? dt.toISOString().split('T')[1].slice(0, 5) : form.scheduled_time,
      });
      notify("Tournament details fetched successfully");
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

  async function handleSendAnnouncementNow(id) {
    setBusyAction("send-ann");
    try {
      await sendAnnouncementNow(token, id);
      notify("Announcement sent successfully");
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
      reannounce: false,
    });
    setIsEditing(true);
  }

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  if (authLoading) return <div className="min-h-screen flex items-center justify-center bg-brand-50"><div className="text-brand-400 font-medium animate-pulse">Initializing system...</div></div>;

  if (!token || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-50 p-6">
        <section className="card max-w-md w-full p-10">
          <div className="text-center mb-10">
            <h1 className="text-2xl font-bold text-brand-900 mb-2">Admin Login</h1>
            <p className="text-sm text-brand-500">Please enter your access key to continue</p>
          </div>
          <form className="space-y-6" onSubmit={handleLogin}>
            <div className="space-y-1.5">
              <label className="label">Access Key</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            {loginError && <p className="text-xs text-danger font-medium">{loginError}</p>}
            <button className="btn btn-primary w-full" type="submit" disabled={busyAction === "login"}>Sign In</button>
          </form>
        </section>
      </div>
    );
  }

  const TabButton = ({ id, label, icon }) => (
    <button 
      className={`nav-item ${activeTab === id ? 'nav-item-active' : ''}`} 
      onClick={() => { setActiveTab(id); setIsMobileMenuOpen(false); }}
    >
      <span className="text-lg">{icon}</span>
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-brand-50 flex flex-col text-brand-900">
      <header className="bg-white border-b border-brand-100 px-6 py-4 sticky top-0 z-50 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <button className="lg:hidden text-brand-600" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
            {isMobileMenuOpen ? '✕' : '☰'}
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-brand-900 text-white flex items-center justify-center rounded-lg font-bold text-sm">C</div>
            <h1 className="text-lg font-bold tracking-tight hidden sm:block">Chess Club Admin</h1>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-brand-500 hidden md:block">{user.username}</span>
          <button className="btn btn-secondary btn-small" onClick={handleLogout}>Sign Out</button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className={`
          fixed inset-0 z-40 bg-white lg:static lg:block lg:w-[260px] border-r border-brand-100 transition-transform duration-300
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}>
          <div className="p-4 space-y-1 mt-16 lg:mt-0">
            <TabButton id="overview" label="Dashboard" icon="📊" />
            <TabButton id="tournaments" label="Tournaments" icon="🏆" />
            <TabButton id="users" label="Members" icon="👥" />
            <TabButton id="announce" label="Announcements" icon="📢" />
            <TabButton id="create" label="Create New" icon="➕" />
            <TabButton id="settings" label="Settings" icon="⚙️" />
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-10">
          {activeTab === 'overview' && (
            <div className="space-y-10 animate-in">
              <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                  { label: "Total Tournaments", val: stats.total, color: "text-brand-900", icon: "📊" },
                  { label: "Planned", val: stats.planned, color: "text-brand-600", icon: "🗓️" },
                  { label: "Active", val: stats.started, color: "text-accent", icon: "🚀" },
                  { label: "Completed", val: stats.finished, color: "text-success", icon: "✅" },
                ].map(s => (
                  <div key={s.label} className="card flex flex-col justify-between">
                    <div className="flex justify-between items-start mb-4">
                        <span className="text-xs font-semibold text-brand-500 uppercase tracking-wider">{s.label}</span>
                        <span className="text-lg">{s.icon}</span>
                    </div>
                    <div className={`text-3xl font-bold tracking-tight ${s.color}`}>{s.val}</div>
                  </div>
                ))}
              </section>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                <section className="card">
                  <div className="flex justify-between items-center border-b border-brand-50 pb-4 mb-6">
                    <h2 className="text-base font-bold text-brand-900">Leaderboard</h2>
                    <span className="text-xs text-brand-400 font-medium">Top 10 Players</span>
                  </div>
                  <div className="space-y-1">
                    {leaderboard.length === 0 ? (
                      <p className="text-sm text-brand-400 italic py-12 text-center">No data available yet...</p>
                    ) : (
                      leaderboard.map((item, index) => (
                        <div key={item.username} className="flex justify-between items-center p-3 rounded-lg hover:bg-brand-50 transition-colors">
                          <div className="flex items-center gap-4">
                            <span className="text-xs font-bold text-brand-300 w-4">{index + 1}</span>
                            <span className="text-sm font-semibold text-brand-700">{item.username}</span>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="h-2 hidden sm:block bg-brand-100 w-32 rounded-full overflow-hidden">
                              <div className="h-full bg-accent" style={{ width: `${(item.wins / Math.max(...leaderboard.map(l => l.wins))) * 100}%` }}></div>
                            </div>
                            <span className="text-sm font-bold text-brand-900 w-6 text-right">{item.wins}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>

                <section className="card">
                    <div className="flex justify-between items-center border-b border-brand-50 pb-4 mb-6">
                        <h2 className="text-base font-bold text-brand-900">Upcoming Events</h2>
                        <button className="text-xs font-bold text-accent hover:underline" onClick={() => setActiveTab('tournaments')}>View All</button>
                    </div>
                    <div className="space-y-3">
                        {tournaments.filter(t => t.status === 'planned').length === 0 ? (
                          <p className="text-sm text-brand-400 italic py-12 text-center">No upcoming events scheduled.</p>
                        ) : (
                          tournaments.filter(t => t.status === 'planned').slice(0, 5).map(t => (
                            <div key={t.tournament_id} className="flex justify-between items-center p-4 border border-brand-100 rounded-xl bg-brand-50/30 hover:border-brand-200 transition-all">
                                <div className="space-y-1 min-w-0 pr-4">
                                    <p className="text-sm font-bold text-brand-800 truncate">{t.name}</p>
                                    <p className="text-xs text-brand-500 font-medium">{formatDate(t.scheduled_for)}</p>
                                </div>
                                <span className="chip bg-white border-brand-100 text-brand-400">
                                    Planned
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
            <div className="space-y-8 animate-in">
              <section className="card">
                <div className="flex flex-col md:flex-row gap-4 mb-8">
                  <div className="relative flex-1">
                    <input className="input pl-10" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tournaments..." />
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-400">🔍</span>
                  </div>
                  <select className="input md:w-64" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="">All Statuses</option>
                    <option value="planned">Planned</option>
                    <option value="started">Active</option>
                    <option value="finished">Completed</option>
                  </select>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {listLoading ? <div className="col-span-full py-20 flex flex-col items-center gap-4 text-brand-400"><div className="w-8 h-8 border-4 border-brand-100 border-t-accent rounded-full animate-spin"></div><span className="text-sm font-medium">Loading data...</span></div> : 
                    tournaments.length === 0 ? <div className="col-span-full py-20 text-center text-brand-400">No tournaments found.</div> :
                    tournaments.map(t => (
                      <button 
                        key={t.tournament_id} 
                        className={`text-left p-5 border rounded-xl transition-all ${selectedId === t.tournament_id ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-brand-100 hover:border-brand-200'}`} 
                        onClick={() => { setSelectedId(t.tournament_id); setIsEditing(false); }}
                      >
                        <div className="flex justify-between items-start mb-4">
                          <h3 className="text-sm font-bold text-brand-900 line-clamp-1 flex-1 mr-2">{t.name}</h3>
                          <span className={`chip ${t.status === 'planned' ? 'bg-blue-50 text-blue-600 border-blue-100' : t.status === 'started' ? 'bg-green-50 text-green-600 border-green-100' : 'bg-brand-50 text-brand-500 border-brand-100'}`}>
                            {t.status}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] font-semibold tracking-wider uppercase">
                          <span className="text-brand-300">{t.tournament_id}</span>
                          <span className="text-brand-400">{formatDate(t.scheduled_for).split(',')[0]}</span>
                        </div>
                      </button>
                    ))
                  }
                </div>
              </section>

              {selectedTournament && !isEditing && (
                <section className="card animate-in">
                  <div className="flex flex-col sm:flex-row justify-between items-start gap-6 border-b border-brand-50 pb-8 mb-8">
                    <div className="space-y-1">
                      <h2 className="text-2xl font-bold text-brand-900">{selectedTournament.name}</h2>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-brand-400">{selectedTournament.tournament_id}</span>
                        <span className="w-1 h-1 bg-brand-200 rounded-full"></span>
                        <span className="text-xs font-bold text-accent uppercase tracking-widest">{selectedTournament.status}</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                        <button className="btn btn-secondary btn-small" onClick={startEditing}>Edit</button>
                        <button className="btn btn-danger btn-small" onClick={() => handleDelete(selectedTournament.tournament_id)}>Delete</button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
                    {[
                      { l: "Format", v: selectedTournament.format, icon: "🏆" },
                      { l: "Time Control", v: selectedTournament.time_control, icon: "⏱️" },
                      { l: "Rated", v: selectedTournament.rated ? "Yes" : "No", icon: "💎" },
                      { l: "Automation", v: selectedTournament.is_automated ? "Active" : "Disabled", icon: "🤖" },
                    ].map(i => (
                      <div key={i.l} className="p-4 bg-brand-50/50 rounded-xl border border-brand-50">
                        <span className="text-[10px] font-bold text-brand-400 uppercase tracking-widest flex items-center gap-1.5 mb-1">{i.icon} {i.l}</span>
                        <div className="text-sm font-bold text-brand-800">{i.v}</div>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                    <div className="space-y-1.5">
                      <span className="label">Scheduled Start</span>
                      <div className="text-sm font-semibold text-brand-700 bg-brand-50/50 p-3 rounded-lg border border-brand-50">{formatDate(selectedTournament.scheduled_for)}</div>
                    </div>
                    <div className="space-y-1.5">
                      <span className="label">Tournament Link</span>
                      <a className="text-sm font-bold text-accent hover:underline bg-brand-50/50 px-4 py-3 rounded-lg border border-brand-50 flex items-center justify-between" href={selectedTournament.chesscom_link} target="_blank" rel="noreferrer">
                        View on Chess.com <span>↗</span>
                      </a>
                    </div>
                  </div>

                  {(selectedTournament.description || selectedTournament.rules) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                      {selectedTournament.description && (
                        <div className="space-y-1.5">
                          <span className="label">Description</span>
                          <div className="bg-brand-50/30 p-4 rounded-xl border border-brand-50 text-sm text-brand-600 leading-relaxed min-h-[100px]">{selectedTournament.description}</div>
                        </div>
                      )}
                      {selectedTournament.rules && (
                        <div className="space-y-1.5">
                          <span className="label">Internal Rules / Notes</span>
                          <div className="bg-brand-50/30 p-4 rounded-xl border border-brand-50 text-sm text-brand-600 leading-relaxed min-h-[100px]">{selectedTournament.rules}</div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="pt-8 border-t border-brand-50 flex flex-col xl:flex-row justify-between items-center gap-8">
                    <div className="flex gap-3 w-full xl:w-auto">
                        {selectedTournament.status === 'planned' && (
                          <button className="btn btn-primary px-8" onClick={() => handleStart(selectedTournament.tournament_id)}>Start Tournament</button>
                        )}
                        <div className="flex items-center px-4 py-2 bg-brand-50 rounded-lg text-xs font-bold text-brand-500 uppercase tracking-wider">
                          Current Status: <span className="text-brand-900 ml-2">{selectedTournament.status}</span>
                        </div>
                    </div>

                    {selectedTournament.status !== 'finished' && (
                      <form className="bg-brand-900 p-6 rounded-2xl w-full max-w-xl shadow-xl" onSubmit={handleFinish}>
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xs font-bold text-white uppercase tracking-widest">Manual Results Entry</h3>
                            <span className="text-[10px] font-bold text-brand-400 bg-brand-800 px-2 py-1 rounded">Admin</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                          <input className="input bg-brand-800 border-brand-700 text-white placeholder:text-brand-500 focus:border-accent" placeholder="Winner" value={resultForm.winner} onChange={e => setResultForm({...resultForm, winner: e.target.value})} required />
                          <input className="input bg-brand-800 border-brand-700 text-white placeholder:text-brand-500 focus:border-accent" placeholder="Runner-up" value={resultForm.runner_up} onChange={e => setResultForm({...resultForm, runner_up: e.target.value})} />
                          <input className="input bg-brand-800 border-brand-700 text-white placeholder:text-brand-500 focus:border-accent" placeholder="3rd Place" value={resultForm.third_place} onChange={e => setResultForm({...resultForm, third_place: e.target.value})} />
                        </div>
                        <div className="flex justify-between items-center">
                          <p className="text-[10px] text-brand-400 font-medium italic">Auto-fetching is enabled for this event.</p>
                          <button className="btn btn-primary btn-small px-6" type="submit" disabled={busyAction === 'finish'}>Publish</button>
                        </div>
                      </form>
                    )}

                    {selectedTournament.status === 'finished' && (
                        <div className="w-full xl:max-w-md bg-accent p-6 rounded-2xl shadow-lg shadow-accent/20">
                            <h3 className="text-[10px] font-bold text-white/70 uppercase tracking-[0.2em] mb-4 text-center">Tournament Podium</h3>
                            <div className="grid grid-cols-3 gap-4">
                              {[
                                { l: "Winner", v: selectedTournament.winner, icon: "🥇" },
                                { l: "Runner-up", v: selectedTournament.runner_up, icon: "🥈" },
                                { l: "3rd Place", v: selectedTournament.third_place, icon: "🥉" },
                              ].map(r => (
                                <div key={r.l} className="text-center">
                                  <div className="text-2xl mb-1">{r.icon}</div>
                                  <strong className="text-sm text-white block truncate mb-1">{r.v || "-"}</strong>
                                  <span className="text-[9px] font-bold text-white/60 uppercase tracking-widest">{r.l}</span>
                                </div>
                              ))}
                            </div>
                        </div>
                    )}
                  </div>
                </section>
              )}

              {selectedTournament && isEditing && (
                  <section className="card animate-in">
                      <h2 className="text-xl font-bold text-brand-900 border-b border-brand-50 pb-4 mb-6">Edit Tournament</h2>
                      <form className="space-y-6" onSubmit={handleUpdate}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div><label className="label">Tournament Name</label><input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></div>
                          <div>
                            <label className="label">Chess.com Link</label>
                            <div className="flex gap-2">
                              <input className="input" value={form.chesscom_link} onChange={e => setForm({...form, chesscom_link: e.target.value})} required />
                              <button className="btn btn-secondary btn-small whitespace-nowrap" type="button" onClick={handleFetchDetails} disabled={busyAction === "fetch-details"}>
                                {busyAction === "fetch-details" ? "Fetching..." : "Fetch Info"}
                              </button>
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div><label className="label">Format</label><select className="input font-semibold" value={form.format} onChange={e => setForm({...form, format: e.target.value})}><option value="Swiss">Swiss</option><option value="Arena">Arena</option></select></div>
                          <div><label className="label">Time Control</label><input className="input" value={form.time_control} onChange={e => setForm({...form, time_control: e.target.value})} /></div>
                          <div><label className="label">Rated</label><div className="flex items-center gap-3 h-[42px] px-3 bg-white border border-brand-200 rounded-lg"><input type="checkbox" className="w-4 h-4 text-accent border-brand-300 rounded focus:ring-accent" checked={form.rated} onChange={e => setForm({...form, rated: e.target.checked})} /><span className="text-sm font-medium text-brand-700">{form.rated ? 'Rated Event' : 'Casual Event'}</span></div></div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 bg-brand-50 rounded-2xl border border-brand-100">
                          <div><label className="label">Start Date</label><input className="input border-brand-200" type="date" value={form.scheduled_date} onChange={e => setForm({...form, scheduled_date: e.target.value})} /></div>
                          <div><label className="label">Start Time (UTC)</label><input className="input border-brand-200" type="time" value={form.scheduled_time} onChange={e => setForm({...form, scheduled_time: e.target.value})} /></div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div><label className="label">Description</label><textarea className="input" value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={4} /></div>
                          <div><label className="label">Rules & Notes</label><textarea className="input" value={form.rules} onChange={e => setForm({...form, rules: e.target.value})} rows={4} /></div>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-8 items-center pt-6 border-t border-brand-50">
                            <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" className="w-5 h-5 text-accent border-brand-300 rounded focus:ring-accent" checked={form.is_automated} onChange={e => setForm({...form, is_automated: e.target.checked})} /><span className="text-sm font-bold text-brand-700">Enable Automation</span></label>
                            <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" className="w-5 h-5 text-accent border-brand-300 rounded focus:ring-accent" checked={form.reannounce} onChange={e => setForm({...form, reannounce: e.target.checked})} /><span className="text-sm font-bold text-brand-700">Announce to Discord</span></label>
                            <label className="flex items-center gap-3"><span className="text-xs font-bold text-brand-400 uppercase tracking-widest whitespace-nowrap">Recurrence</span><select className="input py-1 text-sm font-bold text-accent bg-transparent border-none focus:ring-0" value={form.recurrence} onChange={e => setForm({...form, recurrence: e.target.value})}><option value="">None</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
                            <div className="sm:ml-auto flex gap-3 w-full sm:w-auto">
                                <button className="btn btn-primary flex-1 sm:flex-none px-10" type="submit" disabled={busyAction === 'update'}>Save Changes</button>
                                <button className="btn btn-secondary flex-1 sm:flex-none" type="button" onClick={() => setIsEditing(false)}>Cancel</button>
                            </div>
                        </div>
                    </form>
                  </section>
              )}
            </div>
          )}

          {activeTab === 'users' && (
              <div className="space-y-8 animate-in">
                <section className="card">
                    <div className="max-w-2xl mx-auto py-8">
                        <div className="text-center mb-8">
                            <h2 className="text-xl font-bold text-brand-900">Member Verification</h2>
                            <p className="text-sm text-brand-500">Link a Discord ID to a Chess.com username</p>
                        </div>
                        <form className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-4 p-6 bg-brand-50 rounded-2xl border border-brand-100" onSubmit={handleManualLink}>
                            <div className="space-y-1.5">
                                <label className="label">Discord ID</label>
                                <input className="input border-brand-200" placeholder="000000000000000000" value={linkUserForm.discord_id} onChange={e => setLinkUserForm({...linkUserForm, discord_id: e.target.value})} required />
                            </div>
                            <div className="space-y-1.5">
                                <label className="label">Chess.com Username</label>
                                <input className="input border-brand-200" placeholder="Username" value={linkUserForm.chesscom_username} onChange={e => setLinkUserForm({...linkUserForm, chesscom_username: e.target.value})} required />
                            </div>
                            <div className="flex items-end">
                                <button className="btn btn-primary h-[42px] px-8 w-full" type="submit" disabled={busyAction === 'link'}>Link User</button>
                            </div>
                        </form>
                    </div>
                </section>

                <section className="card">
                    <div className="flex justify-between items-center border-b border-brand-50 pb-4 mb-6">
                        <h2 className="text-base font-bold text-brand-900">Verified Directory</h2>
                        <span className="text-xs font-bold text-brand-400 bg-brand-50 px-3 py-1 rounded-full">{users.length} Members</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {users.length === 0 ? <p className="col-span-full text-center py-20 text-brand-400 italic">No verified members found.</p> : 
                            users.map(u => (
                                <div key={u.discord_id} className="p-4 border border-brand-100 rounded-xl hover:border-accent/30 transition-all flex justify-between items-center group">
                                    <div className="min-w-0 pr-4">
                                        <strong className="text-sm font-bold text-brand-800 block truncate">{u.chesscom_username}</strong>
                                        <span className="text-[10px] text-brand-400 font-medium">ID: {u.discord_id}</span>
                                    </div>
                                    <button className="w-8 h-8 flex items-center justify-center text-danger hover:bg-danger/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100" onClick={() => handleUnlink(u.discord_id)} title="Unlink User">
                                        <span>✕</span>
                                    </button>
                                </div>
                            ))
                        }
                    </div>
                </section>
              </div>
          )}

          {activeTab === 'announce' && (
            <div className="space-y-8 animate-in">
              <section className="card">
                <div className="flex justify-between items-center border-b border-brand-50 pb-4 mb-8">
                    <h2 className="text-base font-bold text-brand-900">New Announcement</h2>
                    <span className="text-xs font-bold text-accent bg-accent/5 px-3 py-1 rounded-full">Markdown Supported</span>
                </div>
                
                <form className="space-y-8" onSubmit={handleAnnounce}>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="space-y-1.5">
                      <label className="label">Target Channel ID</label>
                      <input className="input" placeholder="000000000000000000" value={announcementForm.channel_id} onChange={e => setAnnouncementForm({...announcementForm, channel_id: e.target.value})} required />
                    </div>
                    <div className="space-y-1.5">
                      <label className="label">Schedule Date (Optional)</label>
                      <input className="input" type="date" value={announcementForm.scheduled_date} onChange={e => setAnnouncementForm({...announcementForm, scheduled_date: e.target.value})} />
                    </div>
                    <div className="space-y-1.5">
                      <label className="label">Schedule Time (Optional)</label>
                      <input className="input" type="time" value={announcementForm.scheduled_time} onChange={e => setAnnouncementForm({...announcementForm, scheduled_time: e.target.value})} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                    <div className="space-y-2">
                      <span className="label">Message Content</span>
                      <textarea className="input min-h-[300px] leading-relaxed resize-none" placeholder="Type your message here..." value={announcementForm.message} onChange={e => setAnnouncementForm({...announcementForm, message: e.target.value})} required />
                    </div>
                    <div className="space-y-2">
                      <span className="label">Live Preview</span>
                      <div className="border border-brand-100 rounded-xl p-6 bg-brand-50/30 min-h-[300px] overflow-auto">
                        <div className="prose prose-sm max-w-none prose-p:my-0">
                          <ReactMarkdown>
                            {announcementForm.message || "*No content to preview...*"}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex justify-end pt-6 border-t border-brand-50">
                      <button className="btn btn-primary px-10" type="submit" disabled={busyAction === 'announce'}>
                        {busyAction === 'announce' ? 'Sending...' : (announcementForm.scheduled_date ? 'Schedule Announcement' : 'Send Now')}
                      </button>
                  </div>
                </form>
              </section>

              <section className="card">
                <div className="flex justify-between items-center border-b border-brand-50 pb-4 mb-6">
                    <h2 className="text-base font-bold text-brand-900">Announcement History</h2>
                </div>
                <div className="space-y-3">
                  {announcements.length === 0 ? <p className="text-center py-12 text-brand-400 italic">No announcements found.</p> : 
                    announcements.map(ann => (
                      <div key={ann.announcement_id} className="p-4 border border-brand-100 rounded-xl hover:border-brand-200 transition-all flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <strong className="text-sm font-bold text-brand-800 block truncate">{ann.message}</strong>
                          <div className="flex items-center gap-3 mt-1">
                              <span className="text-[10px] font-bold text-brand-400 uppercase">Channel: {ann.channel_id}</span>
                              <span className="w-1 h-1 bg-brand-200 rounded-full"></span>
                              <span className="text-[10px] font-medium text-brand-400">{formatDate(ann.scheduled_for)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          {!ann.sent && <button className="btn btn-primary btn-small py-1 px-3 text-[10px]" onClick={() => handleSendAnnouncementNow(ann.announcement_id)} disabled={busyAction === 'send-ann'}>Send Now</button>}
                          <span className={`chip ${ann.sent ? 'bg-brand-50 text-brand-400 border-brand-100' : 'bg-accent/10 text-accent border-accent/20'}`}>
                            {ann.sent ? 'Sent' : 'Scheduled'}
                          </span>
                          {!ann.sent && <button className="w-8 h-8 flex items-center justify-center text-danger hover:bg-danger/10 rounded-lg transition-colors" onClick={() => handleDeleteAnnouncement(ann.announcement_id)}>✕</button>}
                        </div>
                      </div>
                    ))
                  }
                </div>
              </section>
            </div>
          )}

          {activeTab === 'create' && (
            <section className="card animate-in max-w-4xl mx-auto">
              <div className="text-center mb-10">
                  <h2 className="text-2xl font-bold text-brand-900">Create New Tournament</h2>
                  <p className="text-sm text-brand-500">Initialize a new event on Chess.com and Discord</p>
              </div>
              
              <form className="space-y-8" onSubmit={handleCreate}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-1.5"><label className="label">Event Name</label><input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required placeholder="e.g. Weekly Blitz #42" /></div>
                  <div className="space-y-1.5">
                    <label className="label">Chess.com Link</label>
                    <div className="flex gap-2">
                      <input className="input" value={form.chesscom_link} onChange={e => setForm({...form, chesscom_link: e.target.value})} required placeholder="https://www.chess.com/tournament/live/..." />
                      <button className="btn btn-secondary btn-small whitespace-nowrap" type="button" onClick={handleFetchDetails} disabled={busyAction === "fetch-details"}>
                        {busyAction === "fetch-details" ? "Fetching..." : "Fetch Info"}
                      </button>
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-1.5"><label className="label">Format</label><select className="input font-semibold" value={form.format} onChange={e => setForm({...form, format: e.target.value})}><option value="Swiss">Swiss</option><option value="Arena">Arena</option></select></div>
                  <div className="space-y-1.5"><label className="label">Time Control</label><input className="input" value={form.time_control} onChange={e => setForm({...form, time_control: e.target.value})} placeholder="e.g. 3+2 or 10 min" /></div>
                  <div className="space-y-1.5"><label className="label">Status</label><div className="flex items-center gap-3 h-[42px] px-4 border border-brand-200 rounded-lg bg-white cursor-pointer" onClick={() => setForm({...form, rated: !form.rated})}><input type="checkbox" className="w-4 h-4 text-accent border-brand-300 rounded focus:ring-accent" checked={form.rated} onChange={() => {}} readOnly /><span className="text-sm font-medium text-brand-700">{form.rated ? 'Rated' : 'Casual'}</span></div></div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 bg-brand-50 rounded-2xl border border-brand-100">
                  <div className="space-y-1.5"><label className="label">Start Date (UTC)</label><input className="input border-brand-200" type="date" value={form.scheduled_date} onChange={e => setForm({...form, scheduled_date: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="label">Start Time (UTC)</label><input className="input border-brand-200" type="time" value={form.scheduled_time} onChange={e => setForm({...form, scheduled_time: e.target.value})} /></div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-1.5"><label className="label">Public Description</label><textarea className="input" value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Details for players..." rows={4} /></div>
                  <div className="space-y-1.5"><label className="label">Staff Notes</label><textarea className="input" value={form.rules} onChange={e => setForm({...form, rules: e.target.value})} placeholder="Internal rules or guidelines..." rows={4} /></div>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-8 items-center pt-8 border-t border-brand-50">
                    <label className="flex items-center gap-3 cursor-pointer group">
                        <input type="checkbox" className="w-5 h-5 text-accent border-brand-300 rounded focus:ring-accent cursor-pointer" checked={form.is_automated} onChange={e => setForm({...form, is_automated: e.target.checked})} />
                        <span className="text-sm font-bold text-brand-700 group-hover:text-accent transition-colors">Enable Automation</span>
                    </label>
                    <label className="flex items-center gap-3"><span className="text-xs font-bold text-brand-400 uppercase tracking-widest">Recurrence</span><select className="input border-none bg-brand-100 py-1 px-4 text-xs font-bold rounded-lg focus:ring-0" value={form.recurrence} onChange={e => setForm({...form, recurrence: e.target.value})}><option value="">None</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
                    <button className="btn btn-primary sm:ml-auto px-12" type="submit" disabled={busyAction === 'create'}>Create Tournament</button>
                </div>
              </form>
            </section>
          )}

          {activeTab === 'settings' && (
            <div className="space-y-8 animate-in max-w-4xl mx-auto">
                <section className="card">
                    <div className="border-b border-brand-50 pb-4 mb-8">
                        <h2 className="text-xl font-bold text-brand-900">System Configuration</h2>
                        <p className="text-sm text-brand-500">Global parameters and Discord integration</p>
                    </div>
                    
                    <form className="space-y-10" onSubmit={handleUpdateSettings}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-1.5"><label className="label">Discord Server (Guild) ID</label><input className="input" value={appSettings.discord_guild_id} onChange={e => setAppSettings({...appSettings, discord_guild_id: e.target.value})} placeholder="000000000000000000" /></div>
                            <div className="space-y-1.5"><label className="label">Chess.com Club ID</label><input className="input" value={appSettings.chesscom_club_id} onChange={e => setAppSettings({...appSettings, chesscom_club_id: e.target.value})} placeholder="club-name" /></div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-1.5"><label className="label">Startup Greeting Channel ID</label><input className="input" value={appSettings.discord_greeting_channel_id} onChange={e => setAppSettings({...appSettings, discord_greeting_channel_id: e.target.value})} placeholder="000000000000000000" /></div>
                            <div className="space-y-1.5"><label className="label">Greeting Message</label><input className="input" value={appSettings.bot_greeting_message} onChange={e => setAppSettings({...appSettings, bot_greeting_message: e.target.value})} placeholder="Grandmaster is online! ♟️" /></div>
                        </div>
                        
                        <div className="space-y-6">
                          <h3 className="text-xs font-bold text-brand-400 uppercase tracking-widest flex items-center gap-4"><span className="h-px bg-brand-100 flex-1"></span> Channel IDs <span className="h-px bg-brand-100 flex-1"></span></h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div className="space-y-1.5"><label className="label text-brand-400">Announcements</label><input className="input text-xs" value={appSettings.discord_announcement_channel_id} onChange={e => setAppSettings({...appSettings, discord_announcement_channel_id: e.target.value})} /></div>
                            <div className="space-y-1.5"><label className="label text-brand-400">Tournament Results</label><input className="input text-xs" value={appSettings.discord_results_channel_id} onChange={e => setAppSettings({...appSettings, discord_results_channel_id: e.target.value})} /></div>
                            <div className="space-y-1.5"><label className="label text-brand-400">Daily Puzzles</label><input className="input text-xs" value={appSettings.discord_puzzle_channel_id} onChange={e => setAppSettings({...appSettings, discord_puzzle_channel_id: e.target.value})} /></div>
                            <div className="space-y-1.5"><label className="label text-brand-400">Opening of Week</label><input className="input text-xs" value={appSettings.discord_opening_channel_id} onChange={e => setAppSettings({...appSettings, discord_opening_channel_id: e.target.value})} /></div>
                          </div>
                        </div>

                        <div className="space-y-6">
                          <h3 className="text-xs font-bold text-brand-400 uppercase tracking-widest flex items-center gap-4"><span className="h-px bg-brand-100 flex-1"></span> Role IDs <span className="h-px bg-brand-100 flex-1"></span></h3>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="space-y-1.5"><label className="label text-brand-400">Players Role</label><input className="input text-xs" value={appSettings.discord_players_role_id} onChange={e => setAppSettings({...appSettings, discord_players_role_id: e.target.value})} /></div>
                            <div className="space-y-1.5"><label className="label text-brand-400">Verified Role</label><input className="input text-xs" value={appSettings.discord_verified_role_id} onChange={e => setAppSettings({...appSettings, discord_verified_role_id: e.target.value})} /></div>
                            <div className="space-y-1.5"><label className="label text-brand-400">Champion Role</label><input className="input text-xs" value={appSettings.discord_champion_role_id} onChange={e => setAppSettings({...appSettings, discord_champion_role_id: e.target.value})} /></div>
                          </div>
                        </div>

                        <div className="flex pt-6">
                            <button className="btn btn-primary px-12" type="submit" disabled={busyAction === 'settings'}>
                                Save System Settings
                            </button>
                        </div>
                    </form>
                </section>
                
                <section className="p-8 bg-red-50 rounded-2xl border border-red-100 space-y-4">
                    <div className="flex items-center gap-3 text-danger">
                        <span className="text-xl">⚠️</span>
                        <h2 className="text-lg font-bold">Danger Zone</h2>
                    </div>
                    <p className="text-sm text-red-600 font-medium">Permanently delete all tournament records, member links, and history. This action cannot be undone.</p>
                    <button className="btn btn-danger" onClick={handleNuke}>Nuke Database</button>
                </section>
            </div>
          )}
        </main>
      </div>

      <div className="fixed bottom-8 right-8 space-y-4 z-[100] max-w-xs w-full pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className={`pointer-events-auto px-6 py-4 rounded-xl border flex items-center gap-4 text-xs font-bold animate-in shadow-xl ${t.type === 'error' ? 'bg-danger border-red-600 text-white' : 'bg-success border-emerald-600 text-white'}`}>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
