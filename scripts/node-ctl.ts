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
  const nodeId = args[1]; // '1' | '2' | '3'

  if (!action || !['stop', 'start'].includes(action) || !nodeId) {
    console.error('Usage: tsx scripts/node-ctl.ts <stop|start> <node_id>');
    console.error('Example: npm run node:stop -- 3');
    process.exit(1);
  }

  const containerName = `bank-node-${nodeId}`;
  console.log(`${action === 'stop' ? 'Stopping' : 'Starting'} container ${containerName}...`);

  try {
    await run('docker', ['compose', action, containerName]);
    console.log(`Container ${containerName} ${action}ed.`);
  } catch (err) {
    console.error(`Failed to ${action} ${containerName}:`, err);
    process.exit(1);
  }
}

main();
