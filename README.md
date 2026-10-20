# PARTWAYS-PORTAL

The PartWays website: plain HTML, CSS and ES modules, no build step.

- `/` home page: the solution, pricing and free sign-up
- `/interview/` employee experience: WhatsApp invitation link, AI voice or text interview, review and submit
- `/hr/` HR workspace for organisations

All API calls go to `/api/*` on the same origin. Locally, run `npm run dev` in `../PARTWAYS-BACKEND`, which serves this folder and the API on http://localhost:8787. `scripts/deploy.sh` in PARTWAYS-BACKEND uploads this folder to S3.
