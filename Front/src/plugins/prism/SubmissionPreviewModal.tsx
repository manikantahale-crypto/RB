import React from 'react';
import { CandidateWorkflow, CandidateWorkflowTab } from '../../components/CandidateWorkflow';
import type { SubmissionRecord } from './SubmissionRTR';

interface SubmissionPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  record: SubmissionRecord | null;
  onViewResume?: () => void;
  initialTab?: string;
}

export type TabType = 'Overview' | 'Candidate Profile' | 'Duplicate Check' | 'Internal Approval' | 'Submission History' | 'Vendors';

export const SubmissionPreviewModal: React.FC<SubmissionPreviewModalProps> = ({ 
  isOpen, 
  onClose, 
  record,
  onViewResume,
  initialTab = 'Overview'
}) => {
  if (!isOpen || !record) return null;

  let mappedTab: CandidateWorkflowTab = 'Overview';
  if (initialTab === 'Vendors' || initialTab === 'Matched Jobs') {
    mappedTab = 'Matched Jobs';
  } else if (initialTab === 'Submission History' || initialTab === 'Internal Approval' || initialTab === 'Submission Flow') {
    mappedTab = 'Submission Flow';
  }

  return (
    <CandidateWorkflow
      record={record}
      submissionId={record.id}
      onClose={onClose}
      onViewResume={onViewResume}
      initialTab={mappedTab}
    />
  );
};
