#!/bin/bash

# Deployment script for imagetool
# Usage: ./deploy.sh [github|vercel]

TARGET=${1:-vercel}

case $TARGET in
  github)
    echo "Building for GitHub Pages deployment (archived)..."
    pnpm build:github
    echo "Build completed. Files are in dist/ folder with /imagetool/ base path."
    echo "Deploy to GitHub Pages by pushing to main branch."
    ;;
  vercel)
    echo "Building for Vercel deployment (main)..."
    pnpm build
    echo "Build completed. Files are in dist/ folder with root base path."
    echo "Deploy to Vercel using: vercel --prod"
    ;;
  *)
    echo "Usage: $0 [github|vercel]"  
    echo "  vercel: Build for Vercel (default)"
    echo "  github: Build for GitHub Pages (archived)"
    exit 1
    ;;
esac