export type NavigationScreen = 'dashboard' | 'upload' | 'matching' | 'jobs' | 'resumes';

export interface User {
  id: string;
  fullName: string;
  email: string;
  role: string;
  createdAt: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface TopSkillDemand {
  name: string;
  count: number;
  color: string;
  maxCount: number;
}

export interface RecentActivityItem {
  id: string;
  jobTitle: string;
  company: string;
  matchScore: number;
  candidateCount: number;
  timeAgo: string;
}

export interface ExtractedAnalysis {
  title: string;
  type: 'Job Description' | 'Resume';
  experience: string;
  workMode: string;
  visa: string;
  location: string;
  skills: string[];
  education?: string;
  availability?: string;
}

export interface JobRequirement {
  id: string;
  title: string;
  company: string;
  location: string;
  workMode: 'Remote' | 'Hybrid' | 'Onsite';
  experience: string;
  visa: string;
  skills: string[];
  matchCount: number;
  avgMatchScore: number;
  /** Pipeline status from API: uploaded | processed | failed */
  processingStatus?: string;
  responsibilities?: string[];
  education?: string;
  description?: string;
  fileName?: string;
  roleTag?: string;
  seniority?: string;
  uploadedDate?: string;
  matchScores?: number[];
  scoreThreshold?: number;
  sourceName?: string;
  sourceType?: string;
  sourceUrl?: string | null;
  sourceEmail?: string | null;
  messageId?: string | null;
  employmentType?: string | null;
  visaRequirement?: string | null;
  remotePolicy?: string | null;
  minExperience?: number | null;
  maxExperience?: number | null;
}

export interface FetchedJDItem {
  id?: string | null;
  title: string;
  company: string;
  location: string;
  source: string;
  sourceUrl?: string | null;
  postedAt?: string;
  status: 'New' | 'Duplicate' | 'Failed';
  skills: string[];
  description: string;
  employmentType?: string | null;
  workMode?: string | null;
  visa?: string | null;
  experience?: string | null;
}

export interface CandidateBreakdown {
  skills: number;
  experience: number;
  location: number;
  visa: number;
  education: number;
  availability: number;
}

export interface MatchingHistoryItem {
  jobTitle: string;
  company: string;
  score: number;
  status: 'Shortlisted' | 'Submitted' | 'Offers' | 'Joined' | 'Hold' | 'Rejected';
  date: string;
}

export type OrbitLifecycleState =
  | 'AVAILABLE'
  | 'BENCH'
  | 'NOTICE'
  | 'PLACED'
  | 'HOLD'
  | 'PRIORITIZE'
  | 'OLD'
  | 'IGNORE';

export interface OrbitLifecycleHistoryItem {
  id: string;
  candidate_id: string;
  state: OrbitLifecycleState;
  previous_state?: string | null;
  transitioned_at: string;
  transitioned_by?: string | null;
  note?: string | null;
  context?: any;
  created_at: string;
}

export interface OrbitActivityItem {
  id: string;
  candidate_id: string;
  activity_type: string;
  actor_type: string;
  actor_id?: string | null;
  summary: string;
  payload?: any;
  occurred_at: string;
  created_at: string;
}

export interface CandidateProfile {
  id: string;
  name: string;
  title: string;
  location: string;
  experience: string;
  expYears: number;
  visa: string;
  matchedSkills: string[];
  missingSkills: string[];
  matchScore: number;
  aiConfidence: number;
  badge: 'Highly Recommended' | 'Recommended' | 'Moderate Fit' | 'Potential Match';
  summary: string;
  breakdown: CandidateBreakdown;
  resumeEvidence: string[];
  aiRecommendationReason: string;
  matchingHistory: MatchingHistoryItem[];
  recruiterStatus?: 'none' | 'reject' | 'hold' | 'shortlisted' | 'submitted';
  fileName?: string;
  roleTag?: string;
  uploadedDate?: string;
  matchCount?: number;
  closestJdsCount?: number;
  processingStatus?: string;
  resumeId?: string;
  poolStatus?: 'Active' | 'Passive';
  // ORBIT Extensions
  orbit_lifecycle_state?: OrbitLifecycleState | string;
  action_needed?: boolean;
  missing_fields?: string[];
  missing_keys?: string[];
  email?: string;
  phone?: string;
  linkedin?: string;
  github?: string;
  education?: any;
  currentCompany?: string;
  currentRole?: string;
  minRate?: string;
  experienceDetail?: any;
}
