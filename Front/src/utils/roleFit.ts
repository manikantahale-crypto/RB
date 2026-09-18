function haystack(parts: Array<string | null | undefined>): string {
  return ` ${parts
    .filter(Boolean)
    .map((p) => String(p).toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim())
    .join(' ')} `;
}

const FAMILIES: Array<{ id: string; keys: string[] }> = [
  {
    id: 'product',
    keys: ['product manager', 'product owner', 'product management', 'product lead', 'group product'],
  },
  {
    id: 'marketing',
    keys: ['demand generation', 'demand gen', 'growth marketing', 'performance marketing', 'digital marketing'],
  },
  {
    id: 'finance',
    keys: [
      'financial manager',
      'finance manager',
      'financial analyst',
      'accountant',
      'controller',
      'bookkeep',
      'fp a',
      'cfo',
      'treasury',
    ],
  },
  {
    id: 'engineering',
    keys: ['software engineer', 'developer', 'full stack', 'backend', 'frontend', 'sde '],
  },
  {
    id: 'data',
    keys: ['data scientist', 'data engineer', 'machine learning', 'ml engineer'],
  },
  {
    id: 'design',
    keys: ['product designer', 'ux designer', 'ui designer'],
  },
  {
    id: 'sales',
    keys: ['account executive', 'sales manager', 'bdr', 'sdr'],
  },
  {
    id: 'recruiting',
    keys: ['recruiter', 'talent acquisition', 'sourcer'],
  },
];

export function roleFamily(parts: Array<string | null | undefined>): string | null {
  const text = haystack(parts);
  if (!text.trim()) return null;
  for (const family of FAMILIES) {
    if (family.keys.some((k) => text.includes(` ${k} `) || text.includes(k))) return family.id;
  }
  return null;
}

export function rolesCompatible(
  jobParts: Array<string | null | undefined>,
  resumeParts: Array<string | null | undefined>,
): boolean {
  const jobFamily = roleFamily(jobParts);
  const resumeFamily = roleFamily(resumeParts);
  if (jobFamily && resumeFamily && jobFamily !== resumeFamily) return false;
  return true;
}
