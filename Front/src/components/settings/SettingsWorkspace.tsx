import React, { useState } from 'react';
import {
  Shield,
  Sliders,
  Bell,
  Database,
  CheckCircle2,
  Save,
  Server,
  Mail,
  Zap,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export const SettingsWorkspace: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'system' | 'ai' | 'workflow' | 'diagnostics'>('system');
  const [savedToast, setSavedToast] = useState(false);

  // Form states
  const [matchThreshold, setMatchThreshold] = useState(65);
  const [seniorityStrictness, setSeniorityStrictness] = useState('moderate');
  const [emailSyncInterval, setEmailSyncInterval] = useState('30');
  const [rtrExpiryHours, setRtrExpiryHours] = useState('48');
  const [notifyOnNewMatch, setNotifyOnNewMatch] = useState(true);
  const [notifyOnConsentReply, setNotifyOnConsentReply] = useState(true);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 3000);
  };

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-5xl mx-auto font-sans w-full">
      {/* Toast Notification */}
      {savedToast && (
        <div className="fixed top-20 right-8 z-50 bg-purple-600 text-white px-5 py-3 rounded-xl shadow-2xl border border-purple-400 font-medium text-sm flex items-center gap-2 animate-in fade-in slide-in-from-top-4 duration-200">
          <CheckCircle2 className="w-4 h-4 text-purple-200" />
          <span>Settings saved successfully</span>
        </div>
      )}

      {/* PAGE HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              Settings & Preferences
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300 text-xs font-bold">
              System v1.2
            </span>
          </div>
          <p className="text-xs md:text-sm text-slate-400 mt-1">
            Configure system parameters, AI thresholds, recruiter notifications, and integrations.
          </p>
        </div>

        <button
          type="button"
          onClick={handleSave}
          className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-purple-900/40 transition cursor-pointer self-start sm:self-auto"
        >
          <Save className="w-3.5 h-3.5" />
          <span>Save Changes</span>
        </button>
      </div>

      {/* NAVIGATION TABS */}
      <div className="flex items-center gap-2 border-b border-[#261e38] pb-1 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('system')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition cursor-pointer ${
            activeTab === 'system'
              ? 'bg-purple-600/20 text-purple-200 border border-purple-500/40'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
          }`}
        >
          <Shield className="w-3.5 h-3.5" />
          <span>Organization & User</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('ai')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition cursor-pointer ${
            activeTab === 'ai'
              ? 'bg-purple-600/20 text-purple-200 border border-purple-500/40'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>AI Matching Engine</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('workflow')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition cursor-pointer ${
            activeTab === 'workflow'
              ? 'bg-purple-600/20 text-purple-200 border border-purple-500/40'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
          }`}
        >
          <Bell className="w-3.5 h-3.5" />
          <span>Workflow & Alerts</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('diagnostics')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition cursor-pointer ${
            activeTab === 'diagnostics'
              ? 'bg-purple-600/20 text-purple-200 border border-purple-500/40'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          <span>System Diagnostics</span>
        </button>
      </div>

      {/* CONTENT PANELS */}
      <form onSubmit={handleSave} className="space-y-6">
        {/* TAB 1: SYSTEM & ORG */}
        {activeTab === 'system' && (
          <div className="space-y-4">
            <div className="p-5 rounded-2xl border border-[#261e38] bg-[#0c0916]/80 glass-card space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Shield className="w-4 h-4 text-purple-400" />
                Active Recruiter Profile
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1">Full Name</label>
                  <input
                    type="text"
                    disabled
                    value={user?.fullName || 'Megha Reddy'}
                    className="w-full px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-300 font-medium cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Email Address</label>
                  <input
                    type="text"
                    disabled
                    value={user?.email || 'meghareddy20@gmail.com'}
                    className="w-full px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-300 font-medium cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Role & Permissions</label>
                  <input
                    type="text"
                    disabled
                    value={user?.role || 'Recruiter'}
                    className="w-full px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-300 font-medium cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Tenant Organization ID</label>
                  <input
                    type="text"
                    disabled
                    value="00000000-0000-0000-0000-000000000001 (TEKISHO)"
                    className="w-full px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 font-mono text-[11px] cursor-not-allowed"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: AI MATCHING ENGINE */}
        {activeTab === 'ai' && (
          <div className="space-y-4">
            <div className="p-5 rounded-2xl border border-[#261e38] bg-[#0c0916]/80 glass-card space-y-5">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Sliders className="w-4 h-4 text-purple-400" />
                Matching Engine Parameters
              </h3>

              <div>
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="font-semibold text-slate-300">Default Match Score Threshold</span>
                  <span className="font-mono font-bold text-purple-400 text-sm">{matchThreshold}%</span>
                </div>
                <input
                  type="range"
                  min="30"
                  max="95"
                  step="5"
                  value={matchThreshold}
                  onChange={(e) => setMatchThreshold(Number(e.target.value))}
                  className="w-full accent-purple-600 h-2 bg-slate-800 rounded-lg cursor-pointer"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Candidates below this similarity score will not be flagged as recommended matches.
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Seniority Level Strictness
                </label>
                <select
                  value={seniorityStrictness}
                  onChange={(e) => setSeniorityStrictness(e.target.value)}
                  className="w-full sm:w-64 px-3.5 py-2 rounded-xl bg-[#120d20] border border-[#261e38] text-xs text-slate-200 font-medium"
                >
                  <option value="lenient">Lenient (Allow +/- 2 years)</option>
                  <option value="moderate">Moderate (Standard +/- 1 year)</option>
                  <option value="strict">Strict (Exact match required)</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: WORKFLOW & ALERTS */}
        {activeTab === 'workflow' && (
          <div className="space-y-4">
            <div className="p-5 rounded-2xl border border-[#261e38] bg-[#0c0916]/80 glass-card space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Bell className="w-4 h-4 text-purple-400" />
                Workflow Automation & Notifications
              </h3>

              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyOnNewMatch}
                    onChange={(e) => setNotifyOnNewMatch(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-purple-600 accent-purple-600 cursor-pointer"
                  />
                  <div className="text-xs">
                    <span className="font-semibold text-slate-200 block">High-Confidence Match Alerts</span>
                    <span className="text-slate-500">Notify when candidate match score exceeds 90%.</span>
                  </div>
                </label>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyOnConsentReply}
                    onChange={(e) => setNotifyOnConsentReply(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-purple-600 accent-purple-600 cursor-pointer"
                  />
                  <div className="text-xs">
                    <span className="font-semibold text-slate-200 block">Candidate Consent & RTR Replies</span>
                    <span className="text-slate-500">Trigger alerts when candidate accepts/declines representation.</span>
                  </div>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1">Email Polling Interval (seconds)</label>
                  <input
                    type="number"
                    value={emailSyncInterval}
                    onChange={(e) => setEmailSyncInterval(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-[#120d20] border border-[#261e38] text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">RTR Auto-Expiry (hours)</label>
                  <input
                    type="number"
                    value={rtrExpiryHours}
                    onChange={(e) => setRtrExpiryHours(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-[#120d20] border border-[#261e38] text-slate-200"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: SYSTEM DIAGNOSTICS */}
        {activeTab === 'diagnostics' && (
          <div className="space-y-4">
            <div className="p-5 rounded-2xl border border-[#261e38] bg-[#0c0916]/80 glass-card space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Database className="w-4 h-4 text-purple-400" />
                Integration Status & Diagnostics
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Server className="w-4 h-4 text-emerald-400" />
                    <div>
                      <span className="font-semibold text-emerald-300 block">Node API Backend</span>
                      <span className="text-[10px] text-emerald-400/80">Port 3001 · Healthy</span>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">ONLINE</span>
                </div>

                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Database className="w-4 h-4 text-emerald-400" />
                    <div>
                      <span className="font-semibold text-emerald-300 block">PostgreSQL Database</span>
                      <span className="text-[10px] text-emerald-400/80">Supabase Session Pool · Connected</span>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">ONLINE</span>
                </div>

                <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Mail className="w-4 h-4 text-purple-400" />
                    <div>
                      <span className="font-semibold text-purple-300 block">Relay Email Listener</span>
                      <span className="text-[10px] text-purple-400/80">IMAP Polling · Active</span>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[10px] font-bold">ACTIVE</span>
                </div>

                <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Zap className="w-4 h-4 text-purple-400" />
                    <div>
                      <span className="font-semibold text-purple-300 block">PRISM Workflow Engine</span>
                      <span className="text-[10px] text-purple-400/80">State Machine v1.0 · Enforced</span>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 text-[10px] font-bold">ACTIVE</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </form>
    </div>
  );
};
