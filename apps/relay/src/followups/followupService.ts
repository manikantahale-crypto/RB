export function calculateDueDate(intent: string): Date {
  const now = new Date();
  
  const highPriorityIntents = [
    'Interview Request',
    'Selected for Interview',
    'Candidate Shortlisted',
    'Need Resume',
    'Rate Asked',
    'Requirement Shared',
    'Client Submission'
  ];

  if (highPriorityIntents.includes(intent)) {
    // Due today 23:59:59 local time
    const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    return due;
  } else {
    // Due tomorrow 17:00:00 local time
    const due = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 17, 0, 0);
    return due;
  }
}
