# Deployment Guide

This project is primarily configured for Vercel deployment with archived GitHub Pages support.

## Vercel Deployment (Main)

Vercel deployment uses root path configuration and includes necessary CORS headers.

### Build for Vercel
```bash
pnpm build
# or
./deploy.sh vercel
```

### Deploy to Vercel
1. Install Vercel CLI: `npm i -g vercel`
2. Login: `vercel login`
3. Deploy: `vercel --prod`

## GitHub Pages Deployment (Archived)

GitHub Pages deployment configuration has been archived but is still available if needed.

### Build for GitHub Pages
```bash
pnpm build:github
# or
./deploy.sh github
```

### Deploy to GitHub Pages
1. Push changes to the `main` branch
2. GitHub Actions will automatically build and deploy

## Key Differences

### Vercel Config (`vite.config.ts` - Main)
- Base path: `/` (root)
- Service worker scope: `/`
- Manifest scope: `/`

### GitHub Pages Config (`archive/vite.config.github.ts` - Archived)
- Base path: `/imagetool/`
- Service worker scope: `/imagetool/`
- Manifest scope: `/imagetool/`

## Headers Configuration

Both platforms include Cross-Origin Isolation headers required for WASM/WebAssembly:
- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Opener-Policy: same-origin`

## Files

- `vite.config.ts` - Main Vercel configuration
- `archive/vite.config.github.ts` - Archived GitHub Pages configuration  
- `vercel.json` - Vercel platform settings
- `deploy.sh` - Deployment helper script