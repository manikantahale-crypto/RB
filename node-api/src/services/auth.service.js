const { z } = require("zod");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const env = require("../config/env");
const userRepo = require("../repositories/user.repository");

const signupSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required"),
  email: z.string().trim().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const loginSchema = z.object({
  email: z.string().trim().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

function formatUserResponse(userRow) {
  return {
    id: userRow.id,
    fullName: userRow.full_name,
    email: userRow.email,
    role: userRow.role,
    createdAt: userRow.created_at,
  };
}

function generateToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
    },
    env.AUTH_JWT_SECRET,
    { expiresIn: "7d" }
  );
}

async function signup(data) {
  const validated = signupSchema.parse(data);
  const normalizedEmail = validated.email.toLowerCase().trim();

  const existingUser = await userRepo.findUserByEmail(normalizedEmail);
  if (existingUser) {
    const error = new Error("Email is already registered");
    error.statusCode = 409;
    throw error;
  }

  const saltRounds = 10;
  const passwordHash = await bcrypt.hash(validated.password, saltRounds);

  let newUser;
  try {
    newUser = await userRepo.createUser({
      fullName: validated.fullName,
      email: normalizedEmail,
      passwordHash,
      role: "Recruiter",
    });
  } catch (err) {
    // Catch Postgres duplicate key error if race condition occurs
    if (err.code === "23505") {
      const conflictErr = new Error("Email is already registered");
      conflictErr.statusCode = 409;
      throw conflictErr;
    }
    throw err;
  }

  const token = generateToken(newUser);

  return {
    user: formatUserResponse(newUser),
    token,
  };
}

async function login(data) {
  const validated = loginSchema.parse(data);
  const normalizedEmail = validated.email.toLowerCase().trim();

  const user = await userRepo.findUserByEmail(normalizedEmail);
  if (!user) {
    const error = new Error("Invalid email or password");
    error.statusCode = 401;
    throw error;
  }

  const isValidPassword = await bcrypt.compare(
    validated.password,
    user.password_hash
  );
  if (!isValidPassword) {
    const error = new Error("Invalid email or password");
    error.statusCode = 401;
    throw error;
  }

  const token = generateToken(user);

  return {
    user: formatUserResponse(user),
    token,
  };
}

async function getMe(userId) {
  if (!userId) {
    const error = new Error("Unauthorized");
    error.statusCode = 401;
    throw error;
  }

  const user = await userRepo.findUserById(userId);
  if (!user) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  return {
    user: formatUserResponse(user),
  };
}

module.exports = {
  signup,
  login,
  getMe,
  signupSchema,
  loginSchema,
};
