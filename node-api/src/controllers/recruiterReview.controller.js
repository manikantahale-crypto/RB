const reviewService = require("../services/recruiterReview.service");
const log = require("../utils/logger");

async function listPending(req, res, next) {
  try {
    log.info(`[recruiterReview] list pending user=${req.userId}`);
    const items = await reviewService.listPending(req.userId);
    res.json({ items, count: items.length });
  } catch (err) {
    next(err);
  }
}

async function decide(req, res, next) {
  try {
    const { id } = req.params;
    const approved = Boolean(req.body?.approved);
    const note = req.body?.note || null;
    log.info(
      `[recruiterReview] decide id=${id} approved=${approved} user=${req.userId}`,
    );
    const result = await reviewService.decide({
      itemId: id,
      userId: req.userId,
      approved,
      note,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function sync(req, res, next) {
  try {
    const stats = await reviewService.syncInbox(req.userId);
    res.json(stats);
  } catch (err) {
    next(err);
  }
}

module.exports = { listPending, decide, sync };
