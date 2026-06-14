# Public Deployment

This project is a static website. It can be published as a normal public website with Vercel, Netlify, Cloudflare Pages, or GitHub Pages.

## Recommended: Vercel

1. Create a new Vercel project.
2. Upload or connect this folder as the project source.
3. Use these settings:
   - Framework Preset: Other
   - Build Command: leave empty
   - Output Directory: `.`
4. Deploy.

## Netlify

1. Create a new Netlify site.
2. Drag and drop this folder, or connect a Git repository.
3. Publish directory: `.`
4. Deploy.

## GitHub Pages

1. Push this folder to a GitHub repository.
2. Open repository Settings > Pages.
3. Source: deploy from branch.
4. Branch: `main`, folder: `/root`.
5. Save.

## Notes

- The page is public after deployment, but user data currently stays in each browser's `localStorage`.
- PDF and DOCX parsing libraries are loaded from CDN when needed.
- For shared accounts, login, cloud storage, and real AI generation, add a backend API and database.
