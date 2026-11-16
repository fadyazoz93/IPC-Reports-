import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import app from './api/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function start() {
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (!isProduction) {
    // Integrate Vite's dev server middleware (HMR disabled to avoid WebSocket port 24678 conflicts)
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    // Serve production static assets
    app.use(express.static(path.join(__dirname, 'dist')));
    
    // SPA fallback: In Express 5 / path-to-regexp v8, catch-all middleware without path string avoids PathError
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) {
        return next();
      }
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running at http://localhost:${port} in ${isProduction ? 'production' : 'development'} mode`);
  });
}

start();
