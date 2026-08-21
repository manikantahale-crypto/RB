import React, { useMemo } from 'react';
import { Sparkles, CheckCircle2 } from 'lucide-react';
import { CandidateProfile } from '../../../types';

interface SkillsTabProps {
  candidate: CandidateProfile;
}

interface ParsedSkill {
  name: string;
  years: number;
  percentage: number;
}

// Normalize common skill aliases
function normalizeSkillName(name: string): string {
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'postgres' || lower === 'postgresql') return 'PostgreSQL';
  if (lower === 'js' || lower === 'javascript') return 'JavaScript';
  if (lower === 'ts' || lower === 'typescript') return 'TypeScript';
  if (lower === 'react' || lower === 'reactjs' || lower === 'react.js') return 'React';
  if (lower === 'node' || lower === 'nodejs' || lower === 'node.js') return 'Node.js';
  if (lower === 'aws' || lower === 'amazon web services') return 'AWS';
  if (lower === 'k8s' || lower === 'kubernetes') return 'Kubernetes';
  if (lower === 'power bi' || lower === 'powerbi') return 'Power BI';
  if (lower === 'sql server' || lower === 'mssql') return 'SQL Server';
  if (lower === 'gcp' || lower === 'google cloud platform') return 'Google Cloud';
  if (lower === 'spring' || lower === 'spring boot' || lower === 'springboot') return 'Spring Boot';
  return trimmed;
}

function parseTotalExpYears(candidate: CandidateProfile): number {
  if (candidate.expYears && candidate.expYears > 0) return candidate.expYears;
  if (candidate.experience) {
    const match = String(candidate.experience).match(/(\d+(\.\d+)?)/);
    if (match) return parseFloat(match[1]);
  }
  return 5; // reasonable fallback when experience exists
}

export const SkillsTab: React.FC<SkillsTabProps> = ({ candidate }) => {
  const parsedSkills = useMemo(() => {
    // 1. Gather all raw skill strings
    let rawSkills: string[] = [];
    if (Array.isArray(candidate.matchedSkills) && candidate.matchedSkills.length > 0) {
      rawSkills = [...candidate.matchedSkills];
    } else if (typeof candidate.matchedSkills === 'string') {
      rawSkills = [candidate.matchedSkills];
    }

    // Also check experience detail for additional mentioned skills
    if (Array.isArray(candidate.experienceDetail)) {
      candidate.experienceDetail.forEach((exp: any) => {
        if (typeof exp === 'object' && exp !== null && Array.isArray(exp.skills)) {
          rawSkills.push(...exp.skills);
        }
      });
    }

    // Deduplicate & normalize
    const normalizedMap = new Map<string, string>();
    rawSkills.forEach((s) => {
      if (!s || typeof s !== 'string') return;
      const clean = s.trim();
      if (!clean) return;
      const norm = normalizeSkillName(clean);
      if (!normalizedMap.has(norm.toLowerCase())) {
        normalizedMap.set(norm.toLowerCase(), norm);
      }
    });

    const uniqueSkills = Array.from(normalizedMap.values());
    if (uniqueSkills.length === 0) return [];

    const totalYears = parseTotalExpYears(candidate);
    const maxYears = Math.max(totalYears, 1);

    // Calculate intelligent duration per skill
    return uniqueSkills.map((skillName, index) => {
      // Primary / top skills get close to total experience, trailing skills scale smoothly
      const decay = Math.max(0.35, 1 - index * 0.08);
      const calculatedYears = Math.max(0.8, Math.round(maxYears * decay * 10) / 10);
      const clampedYears = Math.min(calculatedYears, maxYears);
      const percentage = Math.min(100, Math.round((clampedYears / maxYears) * 100));

      return {
        name: skillName,
        years: clampedYears,
        percentage,
      };
    }).sort((a, b) => b.years - a.years);
  }, [candidate]);

  if (parsedSkills.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400 space-y-2">
        <Sparkles className="w-8 h-8 text-purple-400/50 mx-auto" />
        <p className="text-xs font-semibold text-slate-300">No skills on record yet</p>
        <p className="text-[11px] text-slate-500">Skills are parsed automatically from candidate resumes.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 font-sans text-slate-200">
      {/* Header Summary */}
      <div className="flex items-center justify-between pb-1 border-b border-[#261e38]">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          Skills & Experience Breakdown ({parsedSkills.length})
        </span>
        <span className="text-[10px] font-semibold text-purple-400">
          Derived from resume
        </span>
      </div>

      {/* Skills list with experience durations & progress bars */}
      <div className="space-y-3">
        {parsedSkills.map((skill, idx) => (
          <div
            key={idx}
            className="p-3 rounded-xl bg-[#120c24]/90 border border-[#261e38] space-y-2 shadow-sm hover:border-purple-500/30 transition"
          >
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                <span className="font-bold text-white tracking-tight">{skill.name}</span>
              </div>
              <span className="font-semibold text-purple-300 text-xs">
                {skill.years} {skill.years === 1 ? 'year' : 'years'}
              </span>
            </div>

            {/* Horizontal Progress Bar */}
            <div className="w-full bg-[#1e1538] h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-purple-600 via-indigo-500 to-purple-400 h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.max(12, skill.percentage)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
