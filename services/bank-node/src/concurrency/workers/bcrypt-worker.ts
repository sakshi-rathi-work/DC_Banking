/**
 * Bcrypt worker for Piscina thread pool.
 * Handles password hashing (cost 10) and verification off the main thread.
 */
import bcrypt from 'bcryptjs';

const BCRYPT_COST = 10;

interface HashTask {
  op: 'hash';
  password: string;
}

interface VerifyTask {
  op: 'verify';
  password: string;
  hash: string;
}

type BcryptTask = HashTask | VerifyTask;

export default async function handler(task: BcryptTask) {
  if (task.op === 'hash') {
    const salt = await bcrypt.genSalt(BCRYPT_COST);
    const hash = await bcrypt.hash(task.password, salt);
    return { hash };
  } else if (task.op === 'verify') {
    const match = await bcrypt.compare(task.password, task.hash);
    return { match };
  } else {
    throw new Error(`Unknown bcrypt worker operation`);
  }
}
