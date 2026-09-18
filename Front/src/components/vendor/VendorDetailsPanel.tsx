import React, { useState } from 'react';
import { X, Building2, Globe, Mail, Phone, MapPin, Loader2, AlertCircle, CheckCircle, XCircle, Clock, Trash2, Edit2 } from 'lucide-react';
import { Vendor, VendorStatus } from '../../types';
import { apiFetch } from '../../services/api';
import { VendorStatusBadge } from './VendorStatusBadge';

interface VendorDetailsPanelProps {
  vendor: Vendor;
  onClose: () => void;
  onUpdate: () => void;
}

export const VendorDetailsPanel: React.FC<VendorDetailsPanelProps> = ({ vendor, onClose, onUpdate }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStatusAction = async (action: 'approve' | 'reject' | 'deactivate' | 'reactivate') => {
    if (!window.confirm(`Are you sure you want to ${action} this vendor?`)) {
      return;
    }

    setError(null);
    setIsProcessing(true);

    try {
      const res = await apiFetch(`/vendors/${vendor.id}/${action}`, { method: 'POST' });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || data.message || `Failed to ${action} vendor`);
      }
      
      onUpdate();
    } catch (err: any) {
      setError(err.message || 'Unable to complete the request. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] bg-[#0b0813] border-l border-white/10 shadow-2xl flex flex-col transform transition-transform duration-300">
      <div className="flex items-center justify-between p-6 border-b border-white/5 bg-[#120d1d]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
            <Building2 className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white leading-tight">{vendor.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-slate-400">{vendor.vendor_type.replace('_', ' ')}</span>
              <VendorStatusBadge status={vendor.status} />
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-white/5 text-slate-400 transition-colors"
          disabled={isProcessing}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Profile Details */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <UserIcon className="w-4 h-4 text-purple-400" />
            Contact & Location
          </h3>
          <div className="grid grid-cols-1 gap-4 p-4 rounded-xl bg-white/5 border border-white/5">
            <DetailRow icon={<Mail />} label="Email" value={vendor.email} />
            <DetailRow icon={<Phone />} label="Phone" value={vendor.phone} />
            <DetailRow icon={<Globe />} label="Website" value={vendor.website} />
            <DetailRow icon={<MapPin />} label="Location" value={vendor.location} />
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <BriefcaseIcon className="w-4 h-4 text-purple-400" />
            Business Details
          </h3>
          <div className="grid grid-cols-1 gap-4 p-4 rounded-xl bg-white/5 border border-white/5">
            <DetailRow icon={null} label="Payment Terms" value={vendor.payment_terms} />
            <DetailRow icon={null} label="Technologies" value={vendor.preferred_technologies} />
            <DetailRow icon={null} label="Immigration Types" value={vendor.preferred_immigration_types} />
            <DetailRow icon={null} label="Created At" value={new Date(vendor.created_at).toLocaleDateString()} />
          </div>
        </section>

      </div>

      {/* Action Footer based on Status */}
      <div className="p-6 border-t border-white/5 bg-[#120d1d] flex flex-col gap-3">
        {vendor.status === 'PENDING' && (
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleStatusAction('approve')}
              disabled={isProcessing}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 font-medium text-sm transition-colors border border-emerald-500/30 disabled:opacity-50"
            >
              <CheckCircle className="w-4 h-4" />
              Approve
            </button>
            <button
              onClick={() => handleStatusAction('reject')}
              disabled={isProcessing}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 font-medium text-sm transition-colors border border-rose-500/20 disabled:opacity-50"
            >
              <XCircle className="w-4 h-4" />
              Reject
            </button>
          </div>
        )}

        {vendor.status === 'ACTIVE' && (
          <button
            onClick={() => handleStatusAction('deactivate')}
            disabled={isProcessing}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 font-medium text-sm transition-colors border border-amber-500/20 disabled:opacity-50"
          >
            <AlertCircle className="w-4 h-4" />
            Deactivate Vendor
          </button>
        )}

        {vendor.status === 'INACTIVE' && (
          <button
            onClick={() => handleStatusAction('reactivate')}
            disabled={isProcessing}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 font-medium text-sm transition-colors border border-emerald-500/20 disabled:opacity-50"
          >
            <CheckCircle className="w-4 h-4" />
            Reactivate Vendor
          </button>
        )}
        
        {vendor.status === 'REJECTED' && (
          <div className="text-center text-sm text-slate-500 p-2">
            This vendor has been rejected.
          </div>
        )}
      </div>
    </div>
  );
};

const DetailRow = ({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string }) => (
  <div className="flex items-center gap-3">
    {icon && <div className="text-slate-500 w-4 h-4 [&>svg]:w-full [&>svg]:h-full">{icon}</div>}
    <span className="text-xs font-medium text-slate-400 w-32">{label}</span>
    <span className="text-sm text-white flex-1 truncate">{value || '-'}</span>
  </div>
);

// Simple stub icons for structural use
const UserIcon = (props: any) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
const BriefcaseIcon = (props: any) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>;
