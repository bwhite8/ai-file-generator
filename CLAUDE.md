# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A Node.js background worker that listens for webhook triggers to process pending jobs from a Neon Postgres database, generates business case PowerPoint presentations using Anthropic's Claude Sonnet 4.6 code execution tool with the pptx skill (python-pptx in a sandboxed container), uploads the result to Vercel Blob, and emails a download link via Resend.

## Commands

- `npm run dev` - Run with hot reload (tsx watch)
- `npm run build` - Compile TypeScript (`tsc` → `dist/`)
- `npm start` - Run compiled output (`node dist/index.js`)

No test runner or linter is configured.

## Architecture

The app is a webhook-driven worker (no polling):

1. **`src/index.ts`** - Entry point. Runs an HTTP server that accepts `POST /trigger` webhook calls to process jobs on demand. Single-concurrency guard prevents overlapping jobs.
2. **`src/worker.ts`** - Orchestrates the job pipeline: generate → upload → complete → email. Email failures are caught separately (non-fatal).
3. **`src/generate.ts`** - Calls Anthropic Messages API with the `code_execution_20250825` tool and `pptx` skill to generate a `.pptx` file in a sandboxed container. Downloads the result via the Anthropic Files API. Handles `pause_turn` for long-running executions.
4. **`src/db.ts`** - Neon serverless Postgres queries. Uses `FOR UPDATE SKIP LOCKED` for safe concurrent claiming. Defines the `BusinessCaseJob` interface.
5. **`src/upload.ts`** - Uploads the PPTX buffer to Vercel Blob with public access.
6. **`src/email.ts`** - Sends a download link email via Resend.

## Required Environment Variables

- `DATABASE_URL` - Neon Postgres connection string
- `ANTHROPIC_API_KEY` - Anthropic API key for Claude
- `BLOB_READ_WRITE_TOKEN` - Vercel Blob storage token
- `RESEND_API_KEY` - Resend email API key
- `RESEND_FROM_EMAIL` - Sender email address
- `WEBHOOK_SECRET` - Secret for authenticating incoming webhook triggers

## Docker

Multi-stage build: `docker build -t ai-file-generator .` — uses Node 22 Alpine.
