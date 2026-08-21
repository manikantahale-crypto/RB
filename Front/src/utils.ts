export const cleanJobTitle = (title: string): string => {
  if (!title) return "";
  // Strip Markdown bold markers
  let cleaned = title.replace(/\*\*/g, "");
  // Strip headers like ##, #
  cleaned = cleaned.replace(/^#+\s*/, "");
  // Strip prefixes like "Job Title:", "Title:"
  cleaned = cleaned.replace(/^(Job\s+Title|Title)\s*:\s*/i, "");
  return cleaned.trim();
};

export const calculateSeniority = (title: string = '', experienceStr: string = ''): string => {
  const t = (title || '').toLowerCase();
  if (t.includes('intern') || t.includes('trainee')) return 'Intern';
  if (t.includes('principal') || t.includes('staff')) return 'Principal';
  if (t.includes('director') || t.includes('head of') || t.includes('vp')) return 'Director';
  if (t.includes('lead') || t.includes('manager') || t.includes('architect')) return 'Lead';
  if (t.includes('senior') || t.includes('sr.') || t.includes('sr ')) return 'Senior';
  if (t.includes('junior') || t.includes('jr.') || t.includes('jr ') || t.includes('entry') || t.includes('associate')) return 'Junior';
  if (t.includes('mid') || t.includes('intermediate')) return 'Mid-Level';

  const expNum = parseInt(experienceStr) || 0;
  if (expNum >= 10) return 'Principal';
  if (expNum >= 7) return 'Lead';
  if (expNum >= 5) return 'Senior';
  if (expNum >= 2) return 'Mid-Level';
  if (expNum > 0) return 'Junior';
  return 'Senior';
};

export const cleanFileName = (fileName: string): string => {
  if (!fileName) return "";
  // Decode URL encoding if any
  let cleaned = decodeURIComponent(fileName);
  // Strip Markdown bold markers
  cleaned = cleaned.replace(/\*\*/g, "");
  // Strip prefixes like "job_title:", "Job Title:" (case-insensitive, optionally with spaces or underscores)
  cleaned = cleaned.replace(/^(job_title|job\s+title|title)\s*:\s*/i, "");
  // Strip underscores at the beginning
  cleaned = cleaned.replace(/^_+/, "");
  // Trim unnecessary whitespace
  cleaned = cleaned.trim();
  return cleaned;
};
