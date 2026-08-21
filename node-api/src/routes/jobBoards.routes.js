const express = require("express");
const jobBoardsController = require("../controllers/jobBoards.controller");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);

router.post("/fetch-requirements", jobBoardsController.fetchRequirements);

module.exports = router;

