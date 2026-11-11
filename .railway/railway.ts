/**
 * Railway service definition (Infrastructure as Code, replaces railway.json). Applied with
 * `railway config plan` / `railway config apply`; see docs/railway.md. Service variables are not
 * managed here (`managed: false`): they are set by deploy/railway/provision.sh and the CD job, and
 * no value ever lives in this repository.
 */
import { defineRailway, project, service, volume } from 'railway/iac';

// This repository manages only its own resources in the environment.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = 'app';

export default defineRailway(() => {
  // All state: SQLite, covers and the nightly snapshots (5 GB, the Hobby maximum).
  const data = volume('app-volume', { region: 'europe-west4-drams3a', sizeMB: 5000 });

  const app = service('app', {
    build: {
      builder: 'DOCKERFILE',
      dockerfilePath: 'Dockerfile',
      buildEnvironment: 'V3',
      // Only what goes into the image triggers a build: Android-only and docs-only commits do not.
      watchPatterns: [
        'apps/server/**',
        'apps/web/**',
        'packages/**',
        'Dockerfile',
        '.dockerignore',
        'package.json',
        'package-lock.json',
        'tsconfig.base.json',
      ],
    },
    deploy: {
      // Waits for the migrations that run on boot.
      healthcheckPath: '/api/v1/health',
      healthcheckTimeout: 300,
      // Restarts on failure (Railway's default policy, so it is not written here: Railway stores
      // defaults as null and the plan would show them as a change forever), at most 5 times.
      restartPolicyMaxRetries: 5,
      // Same grace period as compose's stop_grace_period: the server closes cleanly on SIGTERM.
      drainingSeconds: 20,
      // App sleeping stays off (the default): the first lever if usage ever exceeds the plan.
      // railway.json also had requiredMountPath "/data"; Railway's service settings have no such
      // field, so it cannot be kept. The volume is always mounted at /data (volumeMounts below).
    },
    // One replica in Amsterdam: a service with a volume cannot have more, and SQLite needs one writer.
    replicas: { 'europe-west4-drams3a': 1 },
    volumeMounts: { '/data': data },
  });

  return project('openlibrary', {
    variables: { managed: false },
    resources: [data, app],
  });
});
