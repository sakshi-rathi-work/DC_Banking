import { spawn } from 'node:child_process';

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`> ${command} ${args.join(' ')}`);
    const proc = spawn(command, args, { stdio: 'inherit', shell: true });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
    proc.on('error', reject);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const action = args[0]; // 'stop' | 'start'
  const dbId = args[1]; // '1' | '2' | '3'

  if (!action || !['stop', 'start'].includes(action) || !dbId) {
    console.error('Usage: tsx scripts/db-ctl.ts <stop|start> <db_id>');
    console.error('Example: npm run db:stop -- 2');
    process.exit(1);
  }

  const containerName = `db-${dbId}`;
  console.log(`${action === 'stop' ? 'Stopping' : 'Starting'} database container ${containerName}...`);

  try {
    await run('docker', ['compose', action, containerName]);
    console.log(`Database container ${containerName} ${action}ed.`);
  } catch (err) {
    console.error(`Failed to ${action} ${containerName}:`, err);
    process.exit(1);
  }
}

main();
