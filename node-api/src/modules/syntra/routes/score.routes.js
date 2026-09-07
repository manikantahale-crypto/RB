/**
 * Scoring a JD against a resume on demand — SYNTRA's half of what used to be
 * `routes/ai.routes.js`. Parsing stayed there; it produces entities and ASTRA
 * parses too. Same URL as before.
 */
const express = require("express");
const scoreController = require("../controllers/score.controller");

const router = express.Router();

router.post("/score-match", scoreController.scoreMatchEndpoint);

module.exports = router;
