import React, { useState, useEffect } from 'react';
import { StickyNote, Plus, Loader2, Clock, User, AlertCircle } from 'lucide-react';
import { CandidateProfile, OrbitActivityItem } from '../../../types';
import { apiFetch } from '../../../services/api';
import {
  isOrchestrationAccepted,
  pollOrbitNoteCount,
} from '../../../utils/orbitOrchestration';

interface NotesTabProps {
  candidate: CandidateProfile;
}

export const NotesTab: React.FC<NotesTabProps> = ({ candidate }) => {
  const [notes, setNotes] = useState<OrbitActivityItem[]>([]);
  const [newNote, setNewNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNotes = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch(`/candidates/${candidate.id}/activities`);
      if (res.ok) {
        const json = await res.json();
        const allActs: OrbitActivityItem[] = json.data || [];
        setNotes(allActs.filter((a) => a.activity_type === 'NOTE'));
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load notes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotes();
  }, [candidate.id]);

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;

    try {
      setSubmitting(true);
      setError(null);
      const res = await apiFetch(`/candidates/${candidate.id}/activities`, {
        method: 'POST',
        body: JSON.stringify({
          summary: newNote.trim(),
          payload: { text: newNote.trim() },
        }),
      });

      if (!res.ok && res.status !== 202) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save note');
      }

      if (isOrchestrationAccepted(res)) {
        await pollOrbitNoteCount(candidate.id, notes.length);
      }

      setNewNote('');
      await fetchNotes();
    } catch (err: any) {
      setError(err.message || 'Failed to save note');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Note Creation Form */}
      <form onSubmit={handleAddNote} className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
          Add Recruiter Note
        </label>
        <textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Record notes from screening call, client feedback, or internal evaluation..."
          rows={3}
          className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500/60 resize-none font-sans"
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-slate-500">
            Visible only to your recruiting team
          </span>
          <button
            type="submit"
            disabled={submitting || !newNote.trim()}
            className="px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-purple-900/30 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                <span>Save Note</span>
              </>
            )}
          </button>
        </div>
      </form>

      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Notes List */}
      <div className="space-y-3">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
          Recruiter Notes History ({notes.length})
        </span>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-slate-400 gap-2 text-xs">
            <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
            <span>Loading notes...</span>
          </div>
        ) : notes.length === 0 ? (
          <div className="text-center py-8 text-slate-400 space-y-1.5 p-4 rounded-xl bg-white/5 border border-white/5">
            <StickyNote className="w-6 h-6 text-purple-400/40 mx-auto" />
            <p className="text-xs font-semibold text-slate-300">No notes recorded yet</p>
            <p className="text-[11px] text-slate-500">Use the form above to record notes on this consultant.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {notes.map((note) => (
              <div
                key={note.id}
                className="p-3.5 rounded-xl bg-white/5 border border-white/10 space-y-2"
              >
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span className="flex items-center gap-1.5 font-semibold text-purple-300">
                    <User className="w-3 h-3" />
                    <span>Recruiter</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-500" />
                    <span>
                      {new Date(note.occurred_at || note.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </span>
                </div>
                <p className="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap font-normal">
                  {note.summary}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
