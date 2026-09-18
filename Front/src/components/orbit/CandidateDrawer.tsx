import React, { useState, useEffect } from 'react';
import {
  X,
  Target,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  User,
  Sparkles,
  Briefcase,
  DollarSign,
  FileText,
  StickyNote,
  Activity as ActivityIcon,
} from 'lucide-react';
import { CandidateProfile, OrbitLifecycleState } from '../../types';
import { apiFetch } from '../../services/api';
import { StatusBadge } from './StatusBadge';
import { TransitionModal } from './TransitionModal';
import { UpdateCandidateModal } from './UpdateCandidateModal';
import { OverviewTab } from './tabs/OverviewTab';
import { SkillsTab } from './tabs/SkillsTab';
import { ExperienceTab } from './tabs/ExperienceTab';
import { PlacementTab } from './tabs/PlacementTab';
import { DocumentsTab } from './tabs/DocumentsTab';
import { NotesTab } from './tabs/NotesTab';
import { ActivityTab } from './tabs/ActivityTab';
import { CandidateWorkflow } from '../CandidateWorkflow';

interface CandidateDrawerProps {
  candidate: CandidateProfile | null;
  onClose: () => void;
  onGoToMatch?: (type: 'job' | 'resume', id: string) => void;
  onCandidateUpdate?: (updated: CandidateProfile) => void;
}

type TabKey = 'overview' | 'experience' | 'skills' | 'placement' | 'documents' | 'notes' | 'activity';

export const CandidateDrawer: React.FC<CandidateDrawerProps> = ({
  candidate,
  onClose,
  onGoToMatch,
  onCandidateUpdate,
}) => {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [showTransitionModal, setShowTransitionModal] = useState(false);
  const [showUpdateProfileModal, setShowUpdateProfileModal] = useState(false);
  const [showWorkflowModal, setShowWorkflowModal] = useState(false);
  const [currentState, setCurrentState] = useState<OrbitLifecycleState | string>(
    candidate?.orbit_lifecycle_state || 'AVAILABLE'
  );

  // Sync state when candidate changes
  useEffect(() => {
    if (!candidate) return;
    setCurrentState(candidate.orbit_lifecycle_state || 'AVAILABLE');
    setActiveTab('overview');

    // Fetch latest lifecycle from backend
    let isMounted = true;
    apiFetch(`/candidates/${candidate.id}/lifecycle`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (isMounted && data?.current_state) {
          setCurrentState(data.current_state);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [candidate?.id]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !showTransitionModal && !showUpdateProfileModal) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, showTransitionModal, showUpdateProfileModal]);

  if (!candidate) return null;

  const handleStateUpdated = (newState: OrbitLifecycleState | string) => {
    setCurrentState(newState);
    if (onCandidateUpdate) {
      onCandidateUpdate({
        ...candidate,
        orbit_lifecycle_state: newState,
      });
    }
  };

  const tabs: { key: TabKey; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: 'overview', label: 'Overview', icon: <User className="w-3.5 h-3.5" /> },
    { key: 'experience', label: 'Experience', icon: <Briefcase className="w-3.5 h-3.5" /> },
    {
      key: 'skills',
      label: 'Skills',
      icon: <Sparkles className="w-3.5 h-3.5" />,
      count: candidate.matchedSkills?.length,
    },
    { key: 'placement', label: 'Placement', icon: <DollarSign className="w-3.5 h-3.5" /> },
    { key: 'documents', label: 'Resume', icon: <FileText className="w-3.5 h-3.5" /> },
    { key: 'notes', label: 'Notes', icon: <StickyNote className="w-3.5 h-3.5" /> },
    { key: 'activity', label: 'Timeline', icon: <ActivityIcon className="w-3.5 h-3.5" /> },
  ];

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex justify-end">
        {/* Click outside backdrop */}
        <div className="flex-1" onClick={onClose} />

        {/* Drawer Panel */}
        <div className="w-full max-w-xl bg-[#0e0a1b] border-l border-purple-500/20 text-slate-100 flex flex-col h-full shadow-2xl relative animate-in slide-in-from-right duration-200">
          {/* Top Header */}
          <div className="p-5 border-b border-[#261e38] space-y-3 bg-[#120c24]">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-11 h-11 rounded-2xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-sm font-bold text-purple-300 shrink-0">
                  {candidate.name
                    .split(' ')
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((n) => n[0])
                    .join('')
                    .toUpperCase() || 'C'}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-extrabold text-white truncate">{candidate.name}</h2>
                    <StatusBadge
                      state={currentState}
                      size="sm"
                      onClick={() => setShowTransitionModal(true)}
                      interactive
                    />
                    {candidate.is_watching && (
                      <span
                        className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/35 tracking-tight flex items-center gap-1 shrink-0"
                        title="ASTRA Watch State: Active job discovery searching for matching opportunities"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                        Watching
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 truncate mt-0.5">{candidate.title}</p>
                </div>
              </div>

              <button
                onClick={onClose}
                className="text-slate-400 hover:text-white p-1.5 rounded-xl hover:bg-white/10 transition cursor-pointer shrink-0"
                title="Close drawer (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Action Needed Diagnostic Banner */}
            {candidate.action_needed && candidate.missing_fields && candidate.missing_fields.length > 0 ? (
              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-between text-xs text-amber-300">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="font-semibold">
                    Missing Fields: {candidate.missing_fields.join(', ')}
                  </span>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 bg-amber-500/20 px-2 py-0.5 rounded">
                  Action Needed
                </span>
              </div>
            ) : (
              <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between text-xs text-emerald-300">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="font-semibold">Consultant Profile Ready</span>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded">
                  Complete
                </span>
              </div>
            )}
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center px-4 border-b border-[#261e38] bg-[#0e0a1b] overflow-x-auto no-scrollbar">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 py-3 px-3 text-xs font-semibold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                    isActive
                      ? 'border-purple-500 text-purple-300 bg-purple-500/5'
                      : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/5'
                  }`}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                  {tab.count !== undefined && (
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                        isActive
                          ? 'bg-purple-500/20 text-purple-300'
                          : 'bg-white/10 text-slate-400'
                      }`}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Tab Content Container */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4 font-sans">
            {activeTab === 'overview' && (
              <OverviewTab
                candidate={{ ...candidate, orbit_lifecycle_state: currentState }}
                onOpenTransition={() => setShowTransitionModal(true)}
              />
            )}
            {activeTab === 'experience' && <ExperienceTab candidate={candidate} />}
            {activeTab === 'skills' && <SkillsTab candidate={candidate} />}
            {activeTab === 'placement' && (
              <PlacementTab
                candidate={{ ...candidate, orbit_lifecycle_state: currentState }}
                onRefreshCandidate={() => {
                  if (onCandidateUpdate && candidate) onCandidateUpdate(candidate);
                }}
              />
            )}
            {activeTab === 'documents' && <DocumentsTab candidate={candidate} />}
            {activeTab === 'notes' && <NotesTab candidate={candidate} />}
            {activeTab === 'activity' && <ActivityTab candidate={candidate} />}
          </div>

          {/* Bottom Drawer Footer */}
          <div className="p-4 border-t border-[#261e38] bg-[#120c24] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowTransitionModal(true)}
                className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold border border-white/10 transition cursor-pointer flex items-center gap-1.5"
              >
                <span>Change Status</span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              </button>

              <button
                onClick={() => setShowUpdateProfileModal(true)}
                className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold border border-white/10 transition cursor-pointer flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                <span>Edit Profile</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold transition cursor-pointer"
              >
                Close
              </button>

              {onGoToMatch && (
                <button
                  onClick={() => {
                    const candId = candidate.id;
                    onClose();
                    onGoToMatch('resume', candId);
                  }}
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-purple-900/50 transition cursor-pointer"
                >
                  <Target className="w-3.5 h-3.5" />
                  <span>Go to Match</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Lifecycle Transition Modal */}
      {showTransitionModal && (
        <TransitionModal
          candidate={candidate}
          currentState={currentState}
          onClose={() => setShowTransitionModal(false)}
          onSuccess={handleStateUpdated}
        />
      )}

      {/* Edit Profile Modal */}
      {showUpdateProfileModal && (
        <UpdateCandidateModal
          candidate={candidate}
          isOpen={showUpdateProfileModal}
          onClose={() => setShowUpdateProfileModal(false)}
          onSuccess={(updated) => {
            setShowUpdateProfileModal(false);
            if (onCandidateUpdate) onCandidateUpdate(updated);
          }}
        />
      )}
      {/* Candidate Workflow Redesign Modal */}
      {showWorkflowModal && (
        <CandidateWorkflow
          candidate={candidate}
          onClose={() => setShowWorkflowModal(false)}
        />
      )}
    </>
  );
};
