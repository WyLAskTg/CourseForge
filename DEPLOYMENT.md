# Public Deployment

This project can be published as a normal public website. AI generation requires a serverless `/api/generate` endpoint, so Cloudflare Pages is the recommended target for the current codebase.

## Recommended: Cloudflare Pages

1. Create a new Cloudflare Pages project.
2. Connect the GitHub repository.
3. Use these settings:
   - Framework preset: None
   - Build Command: leave empty
   - Output Directory: `.`
4. Deploy.
5. Open the Pages project settings and add environment variables:
   - `OPENAI_API_KEY`: your OpenAI API key
   - `OPENAI_MODEL`: optional model override, such as `gpt-5.5`
6. Redeploy after adding the environment variables.

## Other hosts

Vercel, Netlify, and GitHub Pages can host the frontend, but the current `functions/api/generate.js` file is written for Cloudflare Pages Functions. To use another host, create that host's equivalent API route and keep the same response contract from `API_CONTRACT.md`.

For local testing, set `OPENAI_API_KEY` before starting the server:

```powershell
$env:OPENAI_API_KEY="your_key_here"
npm start
```

## Notes

- The page is public after deployment, but user data currently stays in each browser's `localStorage`.
- PDF and DOCX parsing libraries are loaded from CDN when needed.
- Real AI generation runs through `POST /api/generate`. See `API_CONTRACT.md`.
- For shared accounts, login, cloud storage, and persistent document libraries, add a backend API and database.
