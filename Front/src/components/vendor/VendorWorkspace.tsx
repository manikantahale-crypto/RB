import React, { useState, useEffect } from 'react';
import { Search, Plus, Loader2, AlertCircle, RefreshCcw } from 'lucide-react';
import { Vendor } from '../../types';
import { apiFetch } from '../../services/api';
import { VendorStatusBadge } from './VendorStatusBadge';
import { VendorOnboardingModal } from './VendorOnboardingModal';
import { VendorDetailsPanel } from './VendorDetailsPanel';
import { ScrollableTableCard } from '../common/ScrollableTableCard';

export const VendorWorkspace: React.FC = () => {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modals & Panels
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');

  const fetchVendors = async () => {
    try {
      setLoading(true);
      setError(null);
      
      let url = '/vendors';
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (typeFilter !== 'ALL') params.append('vendor_type', typeFilter);
      if (search) params.append('search', search);

      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      const res = await apiFetch(url);
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || data.message || 'Failed to fetch vendors');
      }
      
      setVendors(data.data || []);
      
      // Update selected vendor if open
      if (selectedVendor) {
        const updated = (data.data || []).find((v: Vendor) => v.id === selectedVendor.id);
        if (updated) setSelectedVendor(updated);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Unable to load vendors. The database might be unreachable.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVendors();
  }, [statusFilter, typeFilter, search]);

  const summary = {
    total: vendors.length,
    pending: vendors.filter(v => v.status === 'PENDING').length,
    active: vendors.filter(v => v.status === 'ACTIVE').length,
    rejected: vendors.filter(v => v.status === 'REJECTED').length,
    inactive: vendors.filter(v => v.status === 'INACTIVE').length,
  };

  return (
    <div className="p-6 md:p-8 space-y-4 max-w-[1600px] w-full mx-auto font-sans h-full min-h-0 flex flex-col overflow-hidden text-slate-100">
      {/* PAGE HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              Vendors
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300 text-xs font-bold">
              {vendors.length}
            </span>
          </div>
          <p className="text-xs md:text-sm text-slate-400 mt-1">
            Manage staffing partners, direct clients, tier-1 agencies, and onboarding workflows.
          </p>
        </div>

        <button
          onClick={() => setShowOnboardingModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-lg shadow-purple-900/40 transition cursor-pointer self-start sm:self-auto hover:scale-[1.02] active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          Add Vendor
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 shrink-0">
        <SummaryCard label="All" count={summary.total} onClick={() => setStatusFilter('ALL')} active={statusFilter === 'ALL'} />
        <SummaryCard label="Pending" count={summary.pending} onClick={() => setStatusFilter('PENDING')} active={statusFilter === 'PENDING'} />
        <SummaryCard label="Active" count={summary.active} onClick={() => setStatusFilter('ACTIVE')} active={statusFilter === 'ACTIVE'} />
        <SummaryCard label="Rejected" count={summary.rejected} onClick={() => setStatusFilter('REJECTED')} active={statusFilter === 'REJECTED'} />
        <SummaryCard label="Inactive" count={summary.inactive} onClick={() => setStatusFilter('INACTIVE')} active={statusFilter === 'INACTIVE'} />
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs md:text-sm font-semibold flex items-center gap-2 shrink-0">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Filters Bar */}
      <div className="flex items-center gap-3 bg-[#120d1d] p-3 rounded-xl border border-[#261e38] shrink-0">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search vendors by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#0b0813] border border-white/10 rounded-lg pl-9 pr-4 py-2 text-xs md:text-sm text-white focus:outline-none focus:border-purple-500/50"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-[#0b0813] border border-white/10 rounded-lg px-3 py-2 text-xs md:text-sm text-white focus:outline-none focus:border-purple-500/50"
        >
          <option value="ALL">All Types</option>
          <option value="DIRECT_CLIENT">Direct Client</option>
          <option value="PRIME_VENDOR">Prime Vendor</option>
          <option value="TIER_1">Tier 1</option>
          <option value="TIER_2">Tier 2</option>
          <option value="STAFFING_AGENCY">Staffing Agency</option>
        </select>
        <button 
          onClick={fetchVendors}
          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-slate-400 hover:text-white transition-colors cursor-pointer"
          title="Refresh"
        >
          <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* DATA TABLE USING ScrollableTableCard */}
      <ScrollableTableCard
        footer={
          <div className="p-4 flex items-center justify-between text-xs text-slate-400">
            <span>Showing <span className="font-semibold text-slate-200">{vendors.length}</span> vendors</span>
            <span className="text-[11px] text-slate-500">Click a vendor row to inspect full profile & tier history</span>
          </div>
        }
      >
        <table className="w-full text-left border-collapse min-w-[1000px]">
          <thead className="sticky top-0 z-20 bg-[#150f27] border-b border-[#261e38] shadow-sm">
            <tr className="border-b border-[#261e38] bg-[#150f27] text-[#94a3b8] font-semibold text-xs uppercase tracking-wider">
              <th className="py-3.5 px-4 bg-[#150f27]">Vendor Name</th>
              <th className="py-3.5 px-4 bg-[#150f27]">Type</th>
              <th className="py-3.5 px-4 bg-[#150f27]">Location</th>
              <th className="py-3.5 px-4 bg-[#150f27]">Status</th>
              <th className="py-3.5 px-4 bg-[#150f27] text-right">Created Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#261e38]/60 text-xs text-slate-300">
            {loading && vendors.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-16 text-center">
                  <Loader2 className="w-6 h-6 text-purple-500 animate-spin mx-auto" />
                  <span className="block mt-2 text-xs text-slate-400">Loading vendors...</span>
                </td>
              </tr>
            ) : vendors.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-16 text-center text-xs text-slate-400">
                  <p className="font-semibold text-slate-300">No vendors found</p>
                  <button onClick={() => setShowOnboardingModal(true)} className="block mx-auto mt-2 text-purple-400 hover:text-purple-300 cursor-pointer">
                    + Add your first vendor
                  </button>
                </td>
              </tr>
            ) : (
              vendors.map((vendor) => (
                <tr 
                  key={vendor.id}
                  onClick={() => setSelectedVendor(vendor)}
                  className="hover:bg-purple-900/10 cursor-pointer transition-colors"
                >
                  <td className="py-3 px-4">
                    <div className="font-medium text-white">{vendor.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{vendor.email || '-'}</div>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-xs text-slate-300 capitalize">{vendor.vendor_type.replace(/_/g, ' ').toLowerCase()}</span>
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-400">{vendor.location || '-'}</td>
                  <td className="py-3 px-4">
                    <VendorStatusBadge status={vendor.status} />
                  </td>
                  <td className="py-3 px-4 text-right text-slate-400">
                    {new Date(vendor.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTableCard>

      {showOnboardingModal && (
        <VendorOnboardingModal 
          onClose={() => setShowOnboardingModal(false)}
          onSuccess={() => {
            setShowOnboardingModal(false);
            fetchVendors();
          }}
        />
      )}

      {selectedVendor && (
        <VendorDetailsPanel 
          vendor={selectedVendor}
          onClose={() => setSelectedVendor(null)}
          onUpdate={fetchVendors}
        />
      )}
    </div>
  );
};

const SummaryCard = ({ label, count, onClick, active }: { label: string, count: number, onClick: () => void, active: boolean }) => (
  <button 
    onClick={onClick}
    className={`p-4 rounded-xl border text-left transition-all ${
      active 
        ? 'bg-purple-500/10 border-purple-500/30 ring-1 ring-purple-500/30' 
        : 'bg-white/5 border-white/5 hover:bg-white/10'
    }`}
  >
    <div className={`text-2xl font-bold ${active ? 'text-purple-400' : 'text-white'}`}>{count}</div>
    <div className={`text-xs font-medium uppercase tracking-wider mt-1 ${active ? 'text-purple-300/70' : 'text-slate-500'}`}>{label}</div>
  </button>
);
