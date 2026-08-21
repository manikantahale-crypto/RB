const matchRepo = require("../src/repositories/match.repository.js");
const jobRepo = require("../src/repositories/job.repository.js");
const resumeRepo = require("../src/repositories/resume.repository.js");

console.log("matchRepo.findTopJobsByVector:", typeof matchRepo.findTopJobsByVector);
console.log("matchRepo.findTopCandidatesByVector:", typeof matchRepo.findTopCandidatesByVector);
console.log("jobRepo.saveEmbedding:", typeof jobRepo.saveEmbedding);
console.log("resumeRepo.saveEmbedding:", typeof resumeRepo.saveEmbedding);
