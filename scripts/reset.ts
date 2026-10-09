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
  console.log('Resetting Distributed Banking System containers and volumes...');
  try {
    await run('docker', ['compose', 'down', '-v']);
    console.log('Reset complete. Fresh state ready.');
  } catch (err) {
    console.error('Reset failed:', err);
    process.exit(1);
  }
}

main();
