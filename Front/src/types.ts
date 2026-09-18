export type NavigationScreen =
  | 'dashboard'
  | 'upload'
  | 'matching'
  | 'inbox'
  | 'jobs'
  | 'resumes'
  | 'vendors'
  | 'prism'
  | 'interview'
  | 'settings';

/** Optional context when navigating from dashboard quick actions. */
export interface NavigationContext {
  candidateId?: string;
  jobId?: string;
  /** Submission & RTR tab filter, e.g. "Ready for Submission" */
  prismTab?: string;
  /** Open submission detail modal on arrival */
  openSubmission?: boolean;
  submissionId?: string;
}

export type VendorStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'INACTIVE';
export type VendorType = 'DIRECT_CLIENT' | 'PRIME_VENDOR' | 'TIER_1' | 'TIER_2' | 'STAFFING_AGENCY';

export interface Vendor {
  id: string;
  name: string;
  vendor_type: VendorType;
  status: VendorStatus;
  website?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  location?: string;
  timezone?: string;
  payment_terms?: string;
  preferred_technologies?: string;
  preferred_immigration_types?: string;
  created_at: string;
  updated_at: string;
}

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
  /** Pipeline status from API: uploaded | processing | processed | failed */
  processingStatus?: string;
  processingError?: string | null;
  uploadedAt?: string;
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
  aiRecommendationLabel?: string;
  aiRecommendationAction?: string;
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
  is_watching?: boolean;
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

// ==========================================
// RELAY Smart Inbox Types
// ==========================================

export type RelayCategory =
  | 'All'
  | 'Vendor Reply'
  | 'Non-Vendor Reply'
  | 'Candidate Response'
  | 'Interview Response'
  | 'Bounce'
  | 'Follow-up'
  | 'Portal Notifications'
  | 'Sent';

export interface RelayAttachment {
  id: string;
  name: string;
  size: string;
  type: string;
}

export interface RelayThreadMessage {
  id: string;
  senderName: string;
  senderEmail: string;
  toEmail?: string;
  isSelf: boolean;
  avatar?: string;
  body: string;
  bodyHtml?: string | null;
  timestamp: string;
  attachments?: RelayAttachment[];
}

export interface RelayContact {
  name: string;
  email: string;
  phone: string;
  company: string;
  title?: string;
  avatar?: string;
}

export interface RelayEmailDetails {
  source: string;
  receivedAt: string;
  to: string;
  cc?: string;
  bcc?: string;
  messageId: string;
  threadId: string;
}

export interface RelayLinkedRequirement {
  jdCode: string;
  role: string;
  positions: number;
  experience: string;
  location: string;
  skills?: string[];
  vendor?: string;
  jobId?: string;
}

export interface RelayTopMatch {
  matchId?: string;
  candidateId: string;
  candidateName: string;
  email?: string;
  score: number;
  tier?: string;
}

export interface RelayActionRequired {
  status: 'Action Required' | 'No Action Required' | 'Waiting for Vendor' | 'Follow-up Required';
  recommendation: string;
  variant?: 'orange' | 'green' | 'blue' | 'purple';
}

export interface RelayRelatedCandidate {
  name: string;
  role: string;
  experience: string;
  availability?: string;
  interviewStage?: string;
  status?: string;
  skills?: string[];
}

export interface RelayAiSummary {
  summary: string;
  keyPoints: string[];
}

export interface RelayFollowUpSla {
  text: string;
  isOverdue?: boolean;
}

export interface RelayEmail {
  id: string;
  category: RelayCategory;
  senderName: string;
  senderEmail: string;
  senderRole?: string;
  senderCompany?: string;
  avatar?: string;
  subject: string;
  preview: string;
  body: string;
  bodyHtml?: string | null;
  timestamp: string;
  receivedDate: string;
  isUnread: boolean;
  isPriority: boolean;
  hasAttachments: boolean;
  attachments?: RelayAttachment[];
  tags: string[];
  messageCount?: number;
  threadGroupCount?: number;
  isSentOnly?: boolean;
  hasInbound?: boolean;
  sentToRecipient?: string;
  relatedInbound?: RelayThreadMessage;
  contact: RelayContact;
  emailDetails: RelayEmailDetails;
  thread: RelayThreadMessage[];
  activity: {
    openCount: number;
    lastOpenedAt: string;
  };
  linkedRequirement?: RelayLinkedRequirement;
  topMatches?: RelayTopMatch[];
  shortlistJobId?: string;
  shortlistStatus?: string;
  actionRequired?: RelayActionRequired;
  relatedCandidate?: RelayRelatedCandidate;
  replyIntent?: string;
  requiresFollowup?: boolean;
  aiSummary?: RelayAiSummary;
  followUpSla?: RelayFollowUpSla;
  suggestedReply?: string;
}

