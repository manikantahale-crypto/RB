import { CandidatesWorkspace } from "./orbit/CandidatesWorkspace";
import React, { useState, useEffect } from 'react';
import { NavigationScreen, JobRequirement, CandidateProfile } from '../types';

import { JobsWorkspace } from './orbit/JobsWorkspace';

interface DataStoreProps {
  jobs: JobRequirement[];
  candidates: CandidateProfile[];
  initialTab?: 'jobs' | 'resumes';
  onNavigate: (screen: NavigationScreen) => void;
  onGoToMatch: (mode: 'job' | 'resume', id: string) => void;
  onUploadClick?: (type: 'jd' | 'resume') => void;
  onRefresh?: () => void;
  onThresholdChange?: (jobId: string, newThreshold: number) => void;
}

export const DataStore: React.FC<DataStoreProps> = ({
  jobs,
  candidates,
  initialTab = 'jobs',
  onNavigate,
  onGoToMatch,
  onUploadClick,
  onRefresh,
  onThresholdChange,
}) => {
  const [activeTab, setActiveTab] = useState<'jobs' | 'resumes'>(initialTab);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  if (activeTab === 'resumes') {
    return (
      <CandidatesWorkspace
        candidates={candidates}
        onNavigate={onNavigate}
        onGoToMatch={onGoToMatch}
        onUploadClick={() => (onUploadClick ? onUploadClick('resume') : onNavigate('upload'))}
        onRefresh={onRefresh}
      />
    );
  }

  return (
    <JobsWorkspace
      jobs={jobs}
      onNavigate={onNavigate}
      onGoToMatch={onGoToMatch}
      onUploadClick={onUploadClick}
      onRefresh={onRefresh}
      onThresholdChange={onThresholdChange}
    />
  );
};
