import { defineConfig } from 'vite'
import { developmentPolicy, productionPolicy } from './scripts/policy.mjs'

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  server: { headers: { 'Content-Security-Policy': developmentPolicy } },
  preview: { headers: { 'Content-Security-Policy': productionPolicy } },
})
