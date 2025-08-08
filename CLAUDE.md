# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `pnpm dev` - Start Vite development server with HMR
- `pnpm build` - Build for production (TypeScript compilation + Vite build)
- `pnpm lint` - Run ESLint
- `pnpm test` - Run unit tests with Vitest
- `pnpm test:watch` - Run tests in watch mode
- `pnpm test:e2e` - Run E2E tests with Playwright
- `pnpm preview` - Preview production build locally

Required Node.js version: 22.18.0 (managed by Volta)

## Architecture Overview

This is a React + TypeScript image processing application that performs object detection and batch image resizing. The architecture follows a worker-based pattern for CPU-intensive operations:

### Key Components

- **App.tsx** - Main application orchestrating components and shared worker instance
- **Dropzone** - Handles file/folder uploads, triggers object detection, manages batch processing UI
- **CanvasEditor** - Interactive canvas for adjusting bounding boxes and crop settings
- **OutputPanel** - Manages output profiles, handles file downloads/auto-save, triggers image composition
- **ProfilesContext** - Global state for output profiles with localStorage persistence

### Worker Architecture

The application uses Web Workers for heavy processing:

- **core.ts** - Main worker coordinator handling message routing
- **yolo.ts** - YOLO v8 object detection using ONNX Runtime
- **opencv.ts** - Image cropping and resizing operations
- **psd.ts** - PSD file generation for Photoshop compatibility

### Data Flow

1. Files dropped → Dropzone creates ImageBitmap → Worker performs detection
2. Detection results → CanvasEditor for user adjustment → ComposePayload
3. ComposePayload → OutputPanel triggers composition → Worker processes images
4. Composed images → Download links or auto-save to selected directory

### Configuration System

- **Output Profiles**: Defined in `public/output_profiles.json` with localStorage override support
- **Layouts**: Grid composition patterns for batch processing (vertical/horizontal/square orientations)
- **ProfilesContext**: Manages profile loading and persistence

### Batch Processing

Supports folder-level batch processing with:
- Automatic grouping by subfolder structure
- Layout-based composition using configurable grid patterns
- Multiple output profiles per group with file naming: `{group}_{profile}.jpg`
- Directory auto-save via File System Access API

### Testing

- Unit tests in `src/test/` using Vitest
- E2E tests in `tests/` using Playwright
- Visual regression testing with pixelmatch for UI consistency

Always run lint and typecheck after making changes. The application uses pnpm for package management and follows the existing ESLint configuration.