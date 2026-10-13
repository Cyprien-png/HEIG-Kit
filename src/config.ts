import path from "node:path";
import dotenv from "dotenv";
import { ROOT } from "./paths.js";

dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });

export interface Config {
  email: string;
  password: string;
  gapsStudentId?: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name} in .env (see .env.example)`);
  }
  return value;
}

export function loadConfig(): Config {
  return {
    email: required("HEIG_EMAIL"),
    password: required("HEIG_PASSWORD"),
    gapsStudentId: process.env.GAPS_STUDENT_ID?.trim() || undefined,
  };
}
