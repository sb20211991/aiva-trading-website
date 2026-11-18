// This new branch did not exist in the connected Worker's production settings.
// Native Cloudflare builds must remain previews until the target is verified.
const branch = process.env.WORKERS_CI_BRANCH;
if (branch && branch !== 'replit/stripe-test-setup') {
  console.error('Worker production publication is blocked pending verified preview and final owner approval.');
  process.exitCode = 1;
} else {
  console.log('Worker configuration prepared for isolated preview verification; live charges stay disabled.');
}
