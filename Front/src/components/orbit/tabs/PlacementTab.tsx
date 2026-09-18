import React, { useState, useEffect, useMemo } from 'react';
import {
  Briefcase,
  DollarSign,
  TrendingUp,
  Plus,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Building2,
  X,
  Clock,
  User,
  Sparkles,
  AlertTriangle,
  History,
} from 'lucide-react';
import { CandidateProfile, Vendor } from '../../../types';
import { apiFetch } from '../../../services/api';

interface PlacementTabProps {
  candidate: CandidateProfile;
  onRefreshCandidate?: () => void;
}

export interface PlacementRecord {
  id: string;
  candidate_id: string;
  client_name: string;
  vendor_name?: string | null;
  placement_type?: string;
  start_date: string;
  end_date?: string | null;
  confirmed_bill_rate: number | string;
  confirmed_pay_rate: number | string;
  billing_frequency?: string;
  pay_frequency?: string;
  employment_model: string;
  work_mode: string;
  location?: string | null;
  notes?: string | null;
  status: string;
  annual_package?: number | string | null;
  monthly_billing?: number | string | null;
  monthly_pay?: number | string | null;
  monthly_gross_margin?: number | string | null;
  created_at: string;
  total_profit_till_today?: number;
  calculated_monthly_amount?: number;
}

const PLACEMENT_TYPES = ['Contract', 'Full-Time', 'Contract-to-Hire', 'Part-Time', 'Other'];
const EMPLOYMENT_MODELS = ['C2C', 'W2', '1099', 'Direct Hire', 'Other'];
const WORK_MODES = ['Remote', 'Hybrid', 'Onsite'];
const FREQUENCIES = ['Hourly', 'Monthly', 'Annual'];
const STANDARD_ANNUAL_HOURS = 2080;

export const PlacementTab: React.FC<PlacementTabProps> = ({
  candidate,
  onRefreshCandidate,
}) => {
  const isCandidatePlaced =
    (candidate.orbit_lifecycle_state || '').toUpperCase() === 'PLACED' ||
    (candidate.status || '').toUpperCase() === 'PLACED';

  const [placements, setPlacements] = useState<PlacementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Record Placement Details Modal State
  const [showPlacementModal, setShowPlacementModal] = useState(false);
  const [clientName, setClientName] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [placementType, setPlacementType] = useState('Contract');
  const [employmentModel, setEmploymentModel] = useState('C2C');
  const [workMode, setWorkMode] = useState('Remote');
  const [placementLocation, setPlacementLocation] = useState(candidate.location || '');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState('');
  const [billingFrequency, setBillingFrequency] = useState('Hourly');
  const [payFrequency, setPayFrequency] = useState('Hourly');
  const [billRate, setBillRate] = useState('');
  const [payRate, setPayRate] = useState('');
  const [annualPackage, setAnnualPackage] = useState('');
  const [placementNotes, setPlacementNotes] = useState('');
  const [submittingPlacement, setSubmittingPlacement] = useState(false);
  const [placementFormError, setPlacementFormError] = useState<string | null>(null);

  const fetchPlacements = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch(`/placements/candidate/${candidate.id}`);
      if (res.ok) {
        const json = await res.json();
        setPlacements(json.data || []);
      } else {
        const errJson = await res.json().catch(() => ({}));
        setError(errJson.error || errJson.message || 'Failed to load placement records');
      }
    } catch (err: any) {
      setError(err.message || 'Error connecting to placement service');
    } finally {
      setLoading(false);
    }
  };

  const fetchVendors = async () => {
    try {
      const res = await apiFetch('/vendors');
      if (res.ok) {
        const json = await res.json();
        setVendors(json.data || []);
      }
    } catch (err) {
      console.error('Failed to load vendors', err);
    }
  };

  useEffect(() => {
    if (isCandidatePlaced) {
      fetchPlacements();
      fetchVendors();
    }
  }, [candidate.id, isCandidatePlaced]);

  // Real-Time Live Financial Calculation in Modal
  const calculatedFinancials = useMemo(() => {
    const bRate = parseFloat(billRate) || 0;
    const pRate = parseFloat(payRate) || 0;

    let monthlyBilling = 0;
    if (billingFrequency === 'Hourly') {
      monthlyBilling = (bRate * STANDARD_ANNUAL_HOURS) / 12;
    } else if (billingFrequency === 'Monthly') {
      monthlyBilling = bRate;
    } else if (billingFrequency === 'Annual') {
      monthlyBilling = bRate / 12;
    }

    let monthlyPay = 0;
    if (payFrequency === 'Hourly') {
      monthlyPay = (pRate * STANDARD_ANNUAL_HOURS) / 12;
    } else if (payFrequency === 'Monthly') {
      monthlyPay = pRate;
    } else if (payFrequency === 'Annual') {
      monthlyPay = pRate / 12;
    }

    const monthlyMargin = monthlyBilling - monthlyPay;
    const annualCompensation =
      annualPackage && parseFloat(annualPackage) > 0
        ? parseFloat(annualPackage)
        : payFrequency === 'Annual'
        ? pRate
        : payFrequency === 'Hourly'
        ? pRate * STANDARD_ANNUAL_HOURS
        : pRate * 12;

    return {
      monthlyBilling: Math.round(monthlyBilling * 100) / 100,
      monthlyPay: Math.round(monthlyPay * 100) / 100,
      monthlyGrossMargin: Math.round(monthlyMargin * 100) / 100,
      annualCompensation: Math.round(annualCompensation * 100) / 100,
      isNegative: monthlyMargin < 0,
    };
  }, [billRate, payRate, billingFrequency, payFrequency, annualPackage]);

  const handleCreatePlacement = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!clientName.trim()) {
      setPlacementFormError('Client / End Customer Name is required.');
      return;
    }
    if (!startDate) {
      setPlacementFormError('Project Start Date is required.');
      return;
    }
    if (!placementLocation.trim()) {
      setPlacementFormError('Work / Project Location is required.');
      return;
    }

    const bRate = parseFloat(billRate);
    const pRate = parseFloat(payRate);
    if (isNaN(bRate) || bRate <= 0 || isNaN(pRate) || pRate <= 0) {
      setPlacementFormError('Billing rate and Pay rate must be positive numbers.');
      return;
    }

    try {
      setSubmittingPlacement(true);
      setPlacementFormError(null);

      const res = await apiFetch('/placements', {
        method: 'POST',
        body: JSON.stringify({
          candidate_id: candidate.id,
          client_name: clientName.trim(),
          vendor_id: vendorId || null,
          placement_type: placementType,
          employment_model: employmentModel,
          work_mode: workMode.toUpperCase(),
          location: placementLocation.trim(),
          start_date: startDate,
          end_date: endDate || null,
          billing_frequency: billingFrequency,
          pay_frequency: payFrequency,
          confirmed_bill_rate: bRate,
          confirmed_pay_rate: pRate,
          annual_package: annualPackage ? parseFloat(annualPackage) : undefined,
          notes: placementNotes.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || data.message || 'Failed to record placement details.');
      }

      setShowPlacementModal(false);
      // Reset form
      setClientName('');
      setVendorName('');
      setBillRate('');
      setPayRate('');
      setAnnualPackage('');
      setPlacementNotes('');

      await fetchPlacements();
      if (onRefreshCandidate) onRefreshCandidate();
    } catch (err: any) {
      setPlacementFormError(err.message || 'Failed to record placement details.');
    } finally {
      setSubmittingPlacement(false);
    }
  };

  // Critical Visibility Guard: Only Placed candidates can access this tab
  if (!isCandidatePlaced) {
    return (
      <div className="p-6 rounded-2xl bg-[#140e29] border border-purple-500/20 text-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mx-auto">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h4 className="text-sm font-bold text-white">Placement Details Restricted</h4>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          Placement records and commercial compensation details are strictly restricted to candidates with status <span className="text-emerald-400 font-bold">Placed</span>.
        </p>
      </div>
    );
  }

  const activePlacement = placements.find((p) => p.status === 'ACTIVE') || placements[0] || null;
  const historyPlacements = placements.filter((p) => p.id !== activePlacement?.id);

  return (
    <div className="space-y-5 text-slate-100 font-sans">
      {/* Header & Quick Action */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            Candidate Placement Details
          </span>
          <p className="text-xs text-slate-400 mt-0.5">
            Confirmed commercial terms, client engagement & gross margins
          </p>
        </div>

        <button
          onClick={() => {
            setPlacementFormError(null);
            setShowPlacementModal(true);
          }}
          className="px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-purple-900/40 transition cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Record Placement Details</span>
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
          <span className="text-xs">Loading placement records...</span>
        </div>
      ) : !activePlacement ? (
        <div className="p-8 rounded-2xl bg-[#140e29] border border-purple-500/20 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400 mx-auto">
            <DollarSign className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">No Placement Details Recorded</h4>
            <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
              This candidate is marked as <span className="text-emerald-400 font-bold">Placed</span>. Record their client contract, rates, and monthly gross margin.
            </p>
          </div>
          <button
            onClick={() => {
              setPlacementFormError(null);
              setShowPlacementModal(true);
            }}
            className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-lg shadow-purple-900/40 transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Record Placement Details</span>
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Active Placement Card */}
          <div className="p-5 rounded-2xl bg-[#140e29] border border-purple-500/30 shadow-xl relative overflow-hidden space-y-5">
            <div className="absolute top-0 right-0 px-3 py-1 bg-emerald-500/20 border-b border-l border-emerald-500/30 text-emerald-300 text-[10px] font-bold uppercase tracking-wider rounded-bl-xl flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              <span>Current Active Placement</span>
            </div>

            {/* 1. Placement Entity Info */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-purple-400" />
                <h3 className="text-base font-extrabold text-white">{activePlacement.client_name}</h3>
                {activePlacement.vendor_name && (
                  <span className="text-xs text-slate-400 font-medium">
                    (via {activePlacement.vendor_name})
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-2.5 rounded-xl bg-white/5 border border-white/5">
                  <span className="text-[10px] font-semibold text-slate-400 block uppercase">Placement Type</span>
                  <span className="font-bold text-slate-200 mt-0.5 block">{activePlacement.placement_type || 'Contract'}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-white/5 border border-white/5">
                  <span className="text-[10px] font-semibold text-slate-400 block uppercase">Employment Model</span>
                  <span className="font-bold text-slate-200 mt-0.5 block">{activePlacement.employment_model || 'C2C'}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-white/5 border border-white/5">
                  <span className="text-[10px] font-semibold text-slate-400 block uppercase">Work Mode</span>
                  <span className="font-bold text-slate-200 mt-0.5 block">{activePlacement.work_mode || 'Remote'}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-white/5 border border-white/5">
                  <span className="text-[10px] font-semibold text-slate-400 block uppercase">Location</span>
                  <span className="font-bold text-slate-200 mt-0.5 block truncate">{activePlacement.location || 'Remote'}</span>
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs text-slate-300 pt-1">
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-purple-400" />
                  <span>Start Date: <strong className="text-white">{activePlacement.start_date}</strong></span>
                </div>
                {activePlacement.end_date && (
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>End Date: <strong className="text-slate-300">{activePlacement.end_date}</strong></span>
                  </div>
                )}
              </div>
            </div>

            {/* 2. Commercials & Calculated Monthly Financials */}
            <div className="pt-3 border-t border-purple-500/20 space-y-3">
              <span className="text-[11px] font-bold text-purple-300 uppercase tracking-wider block flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>Commercial Terms & Monthly Financials</span>
              </span>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {/* Rates Card */}
                <div className="p-3 rounded-xl bg-[#1a1236] border border-purple-500/20 space-y-1">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase block">Rates</span>
                  <div className="flex items-center justify-between text-xs pt-0.5">
                    <span className="text-slate-300">Bill Rate:</span>
                    <span className="font-bold text-emerald-300 font-mono">${activePlacement.confirmed_bill_rate}/{activePlacement.billing_frequency === 'Monthly' ? 'mo' : activePlacement.billing_frequency === 'Annual' ? 'yr' : 'hr'}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">Pay Rate:</span>
                    <span className="font-bold text-slate-200 font-mono">${activePlacement.confirmed_pay_rate}/{activePlacement.pay_frequency === 'Monthly' ? 'mo' : activePlacement.pay_frequency === 'Annual' ? 'yr' : 'hr'}</span>
                  </div>
                  {activePlacement.annual_package && (
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-white/5">
                      <span className="text-slate-400 text-[11px]">Annual Pkg:</span>
                      <span className="font-bold text-purple-300 font-mono">${Number(activePlacement.annual_package).toLocaleString()}</span>
                    </div>
                  )}
                </div>

                {/* Monthly Breakdown Card */}
                <div className="p-3 rounded-xl bg-[#1a1236] border border-purple-500/20 space-y-1">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase block">Monthly Volume</span>
                  <div className="flex items-center justify-between text-xs pt-0.5">
                    <span className="text-slate-300">Monthly Billing:</span>
                    <span className="font-bold text-emerald-400 font-mono">
                      ${Number(activePlacement.monthly_billing || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">Monthly Pay:</span>
                    <span className="font-bold text-slate-300 font-mono">
                      ${Number(activePlacement.monthly_pay || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                {/* Monthly Gross Margin Highlight */}
                <div className="p-3 rounded-xl bg-gradient-to-br from-purple-900/40 to-emerald-900/20 border border-emerald-500/30 space-y-0.5 sm:col-span-1 col-span-2">
                  <span className="text-[10px] font-extrabold text-emerald-300 uppercase tracking-wider block">Monthly Gross Margin</span>
                  <div className="text-lg font-black text-emerald-400 font-mono pt-1">
                    ${Number(activePlacement.monthly_gross_margin || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    <span className="text-xs font-normal text-emerald-300/80 block">/month spread</span>
                  </div>
                </div>
              </div>

              {activePlacement.notes && (
                <p className="text-xs text-slate-400 italic bg-white/5 p-2.5 rounded-xl border border-white/5">
                  "{activePlacement.notes}"
                </p>
              )}
            </div>
          </div>

          {/* Placement History */}
          {historyPlacements.length > 0 && (
            <div className="space-y-3 pt-2">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-purple-400" />
                <span>Placement History ({historyPlacements.length})</span>
              </h4>

              <div className="space-y-2.5">
                {historyPlacements.map((hp) => (
                  <div
                    key={hp.id}
                    className="p-3.5 rounded-xl bg-[#110c22] border border-white/5 hover:border-purple-500/20 transition text-xs space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-200">{hp.client_name}</span>
                        {hp.vendor_name && <span className="text-slate-400">({hp.vendor_name})</span>}
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/10 text-slate-400 uppercase">
                          {hp.employment_model} ÔÇó {hp.placement_type || 'Contract'}
                        </span>
                      </div>
                      <span className="text-[10px] font-bold text-slate-500 uppercase">
                        {hp.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-slate-400">
                      <div>
                        <span>Duration: </span>
                        <strong className="text-slate-300">{hp.start_date} ÔåÆ {hp.end_date || 'Present'}</strong>
                      </div>
                      <div>
                        <span>Rates: </span>
                        <strong className="text-emerald-300 font-mono">${hp.confirmed_bill_rate}</strong> / <strong className="text-slate-300 font-mono">${hp.confirmed_pay_rate}</strong>
                      </div>
                      <div>
                        <span>Monthly Margin: </span>
                        <strong className="text-emerald-400 font-mono">${Number(hp.monthly_gross_margin || 0).toLocaleString()}</strong>
                      </div>
                      <div className="truncate">
                        <span>Location: </span>
                        <strong className="text-slate-300">{hp.location || 'Remote'}</strong>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* RECORD PLACEMENT DETAILS MODAL */}
      {showPlacementModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-[#120c24] border border-purple-500/30 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-4 border-b border-[#261e38] bg-[#160f2e] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
                  <Briefcase className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Record Placement Details</h3>
                  <p className="text-xs text-slate-400">Commercial & employment terms for placed candidate</p>
                </div>
              </div>

              <button
                onClick={() => setShowPlacementModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Read-Only Candidate Information Banner */}
            <div className="px-5 py-3 bg-[#181131] border-b border-[#261e38] flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-purple-400" />
                <span className="text-slate-400">Candidate:</span>
                <strong className="text-white font-bold">{candidate.name}</strong>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">Candidate Status:</span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-extrabold text-[10px] uppercase border border-emerald-500/30">
                  Placed
                </span>
              </div>
            </div>

            {placementFormError && (
              <div className="m-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{placementFormError}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleCreatePlacement} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              {/* 1. CLIENT & VENDOR */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">
                    Client / End Customer *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. JPMorgan Chase, Apple, Walmart"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">
                    Prime Vendor / Vendor
                  </label>
                  <select
                    value={vendorId}
                    onChange={(e) => setVendorId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#181131] border border-white/10 text-slate-100 focus:outline-none focus:border-purple-500 cursor-pointer"
                  >
                    <option value="">No Vendor Selected</option>
                    {vendors.map(v => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.vendor_type.replace('_', ' ')}) - {v.status}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 2. PLACEMENT TYPE, EMPLOYMENT MODEL & WORK MODE */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">
                    Placement Type *
                  </label>
                  <select
                    value={placementType}
                    onChange={(e) => setPlacementType(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#181131] border border-white/10 text-slate-100 focus:outline-none focus:border-purple-500 cursor-pointer"
                  >
                    {PLACEMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">
                    Employment Model *
                  </label>
                  <select
                    value={employmentModel}
                    onChange={(e) => setEmploymentModel(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#181131] border border-white/10 text-slate-100 focus:outline-none focus:border-purple-500 cursor-pointer"
                  >
                    {EMPLOYMENT_MODELS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">
                    Work Mode *
                  </label>
                  <select
                    value={workMode}
                    onChange={(e) => setWorkMode(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#181131] border border-white/10 text-slate-100 focus:outline-none focus:border-purple-500 cursor-pointer"
                  >
                    {WORK_MODES.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 3. DATES & LOCATION */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">
                    Project Start Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-200 focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">
                    Expected End Date {placementType === 'Full-Time' ? '(Optional)' : ''}
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-200 focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">
                    Work / Project Location *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Atlanta, GA / Remote"
                    value={placementLocation}
                    onChange={(e) => setPlacementLocation(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              {/* 4. COMPENSATION & COMMERCIALS */}
              <div className="p-4 rounded-xl bg-[#181131] border border-purple-500/30 space-y-3">
                <span className="text-[11px] font-bold text-purple-300 uppercase tracking-wider block flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5" />
                  <span>Compensation & Commercial Terms</span>
                </span>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-300 block mb-1">
                      Billing Frequency *
                    </label>
                    <select
                      value={billingFrequency}
                      onChange={(e) => setBillingFrequency(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-xl bg-[#120c24] border border-white/10 text-slate-100 focus:outline-none focus:border-purple-500 cursor-pointer text-xs"
                    >
                      {FREQUENCIES.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-300 block mb-1">
                      Billing Rate * ({billingFrequency === 'Monthly' ? '$/mo' : billingFrequency === 'Annual' ? '$/yr' : '$/hr'})
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      required
                      placeholder="e.g. 85"
                      value={billRate}
                      onChange={(e) => setBillRate(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-xl bg-[#120c24] border border-white/10 text-xs text-emerald-300 font-bold font-mono focus:outline-none focus:border-purple-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-300 block mb-1">
                      Pay Frequency *
                    </label>
                    <select
                      value={payFrequency}
                      onChange={(e) => setPayFrequency(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-xl bg-[#120c24] border border-white/10 text-slate-100 focus:outline-none focus:border-purple-500 cursor-pointer text-xs"
                    >
                      {FREQUENCIES.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-300 block mb-1">
                      Candidate Pay Rate * ({payFrequency === 'Monthly' ? '$/mo' : payFrequency === 'Annual' ? '$/yr' : '$/hr'})
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      required
                      placeholder="e.g. 60"
                      value={payRate}
                      onChange={(e) => setPayRate(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-xl bg-[#120c24] border border-white/10 text-xs text-slate-200 font-bold font-mono focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>

                {/* Annual Package (For Full-Time / Direct Hire or optional for other) */}
                <div className="pt-2">
                  <label className="text-[10px] font-bold text-slate-300 block mb-1">
                    Annual Compensation / Package (Optional, e.g. for Full-Time: $120,000)
                  </label>
                  <input
                    type="number"
                    step="1000"
                    placeholder="e.g. 120000"
                    value={annualPackage}
                    onChange={(e) => setAnnualPackage(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl bg-[#120c24] border border-white/10 text-xs text-purple-300 font-mono focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              {/* 5. AUTOMATED LIVE FINANCIAL PREVIEW */}
              <div className={`p-4 rounded-xl border transition-all ${
                calculatedFinancials.isNegative
                  ? 'bg-red-500/10 border-red-500/40'
                  : 'bg-gradient-to-r from-purple-900/30 via-[#181131] to-emerald-950/30 border-emerald-500/30'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Automated Monthly Financials (2,080 hrs/yr basis)</span>
                  </span>
                  {calculatedFinancials.isNegative && (
                    <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-300 text-[10px] font-bold">
                      Negative Margin Warning
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-2.5 rounded-lg bg-black/20">
                    <span className="text-[10px] text-slate-400 block font-semibold">Monthly Billing</span>
                    <strong className="text-sm font-bold text-emerald-300 font-mono">
                      ${calculatedFinancials.monthlyBilling.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </strong>
                  </div>

                  <div className="p-2.5 rounded-lg bg-black/20">
                    <span className="text-[10px] text-slate-400 block font-semibold">Monthly Pay</span>
                    <strong className="text-sm font-bold text-slate-300 font-mono">
                      ${calculatedFinancials.monthlyPay.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </strong>
                  </div>

                  <div className="p-2.5 rounded-lg bg-black/30 border border-emerald-500/30">
                    <span className="text-[10px] text-emerald-300 block font-extrabold">Gross Margin</span>
                    <strong className={`text-sm font-black font-mono ${calculatedFinancials.isNegative ? 'text-red-400' : 'text-emerald-400'}`}>
                      ${calculatedFinancials.monthlyGrossMargin.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </strong>
                  </div>
                </div>
              </div>

              {/* 6. NOTES */}
              <div>
                <label className="text-[11px] font-bold text-slate-300 block mb-1">
                  Placement Notes / Commercial Details
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Direct client engagement via MSP, 6 months duration with extension option..."
                  value={placementNotes}
                  onChange={(e) => setPlacementNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500"
                />
              </div>
            </form>

            {/* Modal Footer */}
            <div className="p-4 border-t border-[#261e38] bg-[#160f2e] flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setShowPlacementModal(false)}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold transition cursor-pointer"
              >
                Cancel
              </button>

              <button
                onClick={handleCreatePlacement}
                disabled={submittingPlacement}
                className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-bold transition flex items-center gap-2 shadow-lg shadow-purple-900/40 cursor-pointer"
              >
                {submittingPlacement ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving Placement...</span>
                  </>
                ) : (
                  <span>Save Placement Record</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
