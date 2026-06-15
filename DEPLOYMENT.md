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
   - `DEEPSEEK_API_KEY`: your DeepSeek API key
   - `DEEPSEEK_MODEL`: optional model override, defaults to `deepseek-chat`
   - `AI_PROVIDER`: optional, set to `openai` only if you want to use OpenAI instead
   - `OPENAI_API_KEY`: optional OpenAI fallback key
   - `OPENAI_MODEL`: optional OpenAI model override
6. Create a Cloudflare D1 database and bind it to the Pages project as `COURSEFORGE_DB`.
7. Create a Cloudflare R2 bucket and bind it to the Pages project as `COURSEFORGE_FILES`.
8. Redeploy after adding variables and bindings. The app creates its D1 tables automatically on first use.

## Other hosts

Vercel, Netlify, and GitHub Pages can host the frontend, but the current `functions/api/generate.js` file is written for Cloudflare Pages Functions. To use another host, create that host's equivalent API route and keep the same response contract from `API_CONTRACT.md`.

For local testing, set `OPENAI_API_KEY` before starting the server:

```powershell
$env:OPENAI_API_KEY="your_key_here"
npm start
```

## Notes

- The page is public after deployment. Without D1/R2 bindings, user data stays in each browser's `localStorage`; with D1/R2 bindings, signed-in users can sync courses, material text, uploaded files, and generation history.
- PDF and DOCX parsing libraries are loaded from CDN when needed.
- Real AI generation runs through `POST /api/generate`. See `API_CONTRACT.md`.
- Login and cloud sync use Cloudflare Pages Functions, D1, and R2.
