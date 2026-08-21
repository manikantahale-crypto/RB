const authService = require("../services/auth.service");
const { ZodError } = require("zod");

async function signup(req, res, next) {
  try {
    const result = await authService.signup(req.body);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof ZodError) {
      const messages = err.issues.map((issue) => issue.message).join(", ");
      return res.status(400).json({ error: messages });
    }
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const result = await authService.login(req.body);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof ZodError) {
      const messages = err.issues.map((issue) => issue.message).join(", ");
      return res.status(400).json({ error: messages });
    }
    next(err);
  }
}

async function getMe(req, res, next) {
  try {
    const result = await authService.getMe(req.userId);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  signup,
  login,
  getMe,
};
