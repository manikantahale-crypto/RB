const { validateCandidateData } = require("./src/validation/candidateValidation");

const testData = {
  email: "invalid-email@",
  phone: "abc-123",
  immigration_status: "H-1B",
  experience: "-5 years",
  first_name: "John",
  last_name: "Doe",
  linkedin: "not-a-url",
  skills: ["Java", "Java", "Spring Boot", "React", "React", null, ""],
  education: null
};

const result = validateCandidateData(testData);
console.log("Validated Data:");
console.log(JSON.stringify(result, null, 2));
