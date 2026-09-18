import React from 'react';
import { LayoutDashboard, UploadCloud, Sliders, Settings, Zap, FileText, User, Inbox, Building2, Send } from 'lucide-react';
import { NavigationScreen } from '../types';

interface SidebarProps {
  activeScreen: NavigationScreen;
  onNavigate?: (screen: NavigationScreen) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeScreen, onNavigate }) => {
  const navItems = [
    { id: 'dashboard' as NavigationScreen, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'upload' as NavigationScreen, label: 'Upload & Analyze', icon: UploadCloud },
    { id: 'matching' as NavigationScreen, label: 'AI Workspace', icon: Sliders },
    { id: 'inbox' as NavigationScreen, label: 'Smart Inbox', icon: Inbox },
    { id: 'jobs' as NavigationScreen, label: 'Job Descriptions', icon: FileText },
    { id: 'resumes' as NavigationScreen, label: 'Resumes', icon: User },
    { id: 'vendors' as NavigationScreen, label: 'Vendors', icon: Building2 },
    { id: 'prism' as NavigationScreen, label: 'Submission & RTR', icon: Send },
  ];

  return (
    <aside className="w-64 h-screen sticky top-0 bg-[#0d0918]/90 border-r border-[#261e38] flex flex-col justify-between shrink-0 z-20 overflow-hidden">
      <div>
        {/* SYNTRA Brand Header */}
        <div className="h-16 flex items-center px-6 gap-3 border-b border-[#261e38]">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-purple-600 to-violet-400 flex items-center justify-center text-white shadow-lg shadow-purple-900/40">
            <Zap className="w-5 h-5 fill-white text-white" />
          </div>
          <span className="font-bold text-xl tracking-wider bg-gradient-to-r from-white via-purple-200 to-purple-400 bg-clip-text text-transparent">
            SYNTRA
          </span>
        </div>

        {/* Navigation Items */}
        <nav className="p-4 space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeScreen === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate?.(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer ${isActive
                  ? 'bg-purple-600/20 text-purple-200 border border-purple-500/30 shadow-lg shadow-purple-950/50'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
                  }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-purple-400' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Settings Link */}
      <div className="p-4 border-t border-[#261e38]">
        <button
          onClick={() => onNavigate?.('settings')}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer ${
            activeScreen === 'settings'
              ? 'bg-purple-600/20 text-purple-200 border border-purple-500/30 shadow-lg shadow-purple-950/50'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
          }`}
        >
          <Settings className={`w-4 h-4 ${activeScreen === 'settings' ? 'text-purple-400' : 'text-slate-400'}`} />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
};
