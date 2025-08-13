# Archive

This folder contains archived configuration files that are no longer actively used but are preserved for reference.

## GitHub Pages Configuration (Archived)

- `vite.config.github.ts` - Vite configuration for GitHub Pages deployment with `/imagetool/` base path

### Usage

If you need to deploy to GitHub Pages again, you can use:

```bash
pnpm build:github
./deploy.sh github
```

This will use the archived configuration from this folder.

## Why Archived?

The project has migrated to Vercel as the primary deployment platform for better performance and easier configuration management. GitHub Pages deployment is kept as an option but is no longer the main deployment target.