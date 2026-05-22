import { loadEnvConfig } from "@next/env";
import "@testing-library/jest-dom/vitest";

// API route tests instantiate Prisma directly, which needs DATABASE_URL.
// Mirror the loader Next.js uses so test envs see .env / .env.local.
loadEnvConfig(process.cwd());
