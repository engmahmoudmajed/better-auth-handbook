// // src/db/drizzle.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import "dotenv/config"
// import postgres from 'postgres';
import * as schema from './schema';

// // 1. Initialize the database connection client
// const queryClient = postgres(process.env.DATABASE_URL!);

// // 2. Export the instantiated Drizzle db instance
export const db = drizzle(process.env.DATABASE_URL!);
//----------------------------

