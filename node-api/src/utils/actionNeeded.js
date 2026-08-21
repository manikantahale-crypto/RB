/**
 * Utility to evaluate if a candidate profile is missing major information
 * required for a complete consultant record.
 *
 * Checks: Skills, Experience, Visa/Work Auth, Location, Availability, Relocation, Ownership.
 * NOTE: Resume is explicitly NOT considered missing.
 *
 * @param {Object} candidate - Candidate record with skills and metadata
 * @returns {Object} { action_needed: boolean, missing_fields: string[], missing_keys: string[], summary: string, count: number }
 */
function computeCandidateActionNeeded(candidate) {
  if (!candidate) {
    return {
      action_needed: false,
      missing_fields: [],
      missing_keys: [],
      summary: '',
      count: 0,
    };
  }

  const missingFields = [];
  const missingKeys = [];

  // 1. Skills
  let skills = candidate.skills || candidate.candidate_skills || candidate.matchedSkills || [];
  if (typeof skills === 'string') {
    try {
      skills = JSON.parse(skills);
    } catch {
      skills = [];
    }
  }
  if (!Array.isArray(skills) || skills.length === 0) {
    missingFields.push('Skills');
    missingKeys.push('skills');
  }

  // 2. Experience
  const exp = candidate.experience_years ?? candidate.years_experience ?? candidate.totalExperience ?? candidate.experience;
  if (exp === null || exp === undefined || exp === '' || exp === 'Not specified' || exp === 'N/A') {
    missingFields.push('Experience');
    missingKeys.push('experience_years');
  }

  // 3. Visa / Work Auth
  const visa = candidate.work_authorization || candidate.immigration_status || candidate.visa;
  if (!visa || visa === '—' || visa === 'N/A' || visa === 'Any') {
    missingFields.push('Visa');
    missingKeys.push('work_authorization');
  }

  // 4. Location
  const location = candidate.location || candidate.current_location || candidate.location_city;
  if (!location || location === 'N/A') {
    missingFields.push('Location');
    missingKeys.push('location');
  }

  // 5. Availability / Status
  const availability = candidate.orbit_lifecycle_state || candidate.availability || candidate.status;
  if (!availability) {
    missingFields.push('Availability');
    missingKeys.push('availability');
  }

  // 6. Preferred Location / Relocation
  if (candidate.relocation === undefined && !candidate.location) {
    missingFields.push('Preferred Location');
    missingKeys.push('relocation');
  }

  // 7. Ownership / Created By
  const owner = candidate.created_by || candidate.owner_user_id;
  if (!owner) {
    missingFields.push('Ownership');
    missingKeys.push('owner_user_id');
  }

  return {
    action_needed: missingFields.length > 0,
    missing_fields: missingFields,
    missing_keys: missingKeys,
    summary: missingFields.length > 0 ? `Missing: ${missingFields.join(', ')}` : '',
    count: missingFields.length,
  };
}

module.exports = {
  computeCandidateActionNeeded,
};
