# PARTWAYS-PORTAL

The PartWays website: plain HTML, CSS and ES modules, no build step.

- `/` home page: the solution, pricing and free sign-up
- `/interview/` employee experience: WhatsApp invitation link, AI voice or text interview, review and submit
- `/hr/` HR workspace for organisations

All API calls go to `/api/*` on the same origin. Locally, run `npm run dev` in `../PARTWAYS-BACKEND`, which serves this folder and the API on http://localhost:8787. Pushing to `main` deploys this folder to S3 and CloudFront through GitHub Actions (`.github/workflows/deploy.yml`). The workflow needs five repository variables, from the `partways-portal` stack outputs in PARTWAYS-BACKEND: `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION`, `S3_BUCKET`, `S3_PREFIX`, `CLOUDFRONT_DISTRIBUTION_ID`.
